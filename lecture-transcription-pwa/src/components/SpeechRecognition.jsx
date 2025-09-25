import { useState, useRef, useEffect } from 'react';
import { doc, setDoc, updateDoc, serverTimestamp, arrayUnion } from 'firebase/firestore';
import { db } from '../firebase';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import syncService from '../services/syncService';
import offlineStorage from '../services/offlineStorage';

function SpeechRecognition({ lectureId, userId }) {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [error, setError] = useState('');
  const [offlineQueueCount, setOfflineQueueCount] = useState(0);
  const [sessionDuration, setSessionDuration] = useState(0);
  const recognitionRef = useRef(null);
  const transcriptRef = useRef('');
  const manualStopRef = useRef(false);
  const sessionStartTime = useRef(null);
  const lastStoredTranscriptRef = useRef('');
  const chunkTimeoutRef = useRef(null);
  const isCreatingChunk = useRef(false);
  const processedResultsLength = useRef(0);
  const { isOnline } = useNetworkStatus();

  useEffect(() => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      setError('Rozpoznawanie mowy nie jest obsługiwane w tej przeglądarce.');
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognitionRef.current = new SpeechRecognition();

    const recognition = recognitionRef.current;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'pl-PL'; // Polish language
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsListening(true);
      setError('');
    };

    recognition.onresult = async (event) => {
      let interim = '';
      let newFinalText = '';

      // Process only NEW final results that we haven't seen before
      for (let i = processedResultsLength.current; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          newFinalText += transcript + ' ';
          processedResultsLength.current = i + 1; // Mark this result as processed
        }
      }

      // Collect all interim results (non-final)
      for (let i = 0; i < event.results.length; i++) {
        if (!event.results[i].isFinal) {
          interim += event.results[i][0].transcript;
        }
      }

      // Update display: add only NEW final text to existing transcript
      if (newFinalText) {
        transcriptRef.current = (transcriptRef.current + ' ' + newFinalText).trim();
        setTranscript(transcriptRef.current);
      }
      setInterimTranscript(interim);

      // Clear any existing timeout
      if (chunkTimeoutRef.current) {
        clearTimeout(chunkTimeoutRef.current);
      }

      // Set timeout to store chunk after 3 seconds of no new speech
      if (newFinalText && lectureId && !isCreatingChunk.current) {
        chunkTimeoutRef.current = setTimeout(async () => {
          const newContent = newFinalText.trim();

          if (newContent && !isCreatingChunk.current) {
            isCreatingChunk.current = true; // Prevent multiple simultaneous chunk creations

            try {
              const newChunk = {
                id: Date.now(),
                text: newContent,
                timestamp: new Date().toISOString()
              };

              const transcriptionData = {
                rawText: transcriptRef.current,
                lastUpdated: new Date().toISOString(),
                newChunk: newChunk
              };

              if (isOnline) {
                try {
                  const transcriptionDoc = doc(db, 'transcriptions', lectureId);
                  await updateDoc(transcriptionDoc, {
                    rawText: transcriptionData.rawText,
                    lastUpdated: serverTimestamp(),
                    chunks: arrayUnion(transcriptionData.newChunk)
                  });
                } catch (err) {
                  console.error('Error updating transcription online, storing offline:', err);
                  await syncService.storeOfflineTranscription(lectureId, transcriptionData, userId);
                  updateOfflineQueueCount();
                }
              } else {
                await syncService.storeOfflineTranscription(lectureId, transcriptionData, userId);
                updateOfflineQueueCount();
              }
            } finally {
              isCreatingChunk.current = false; // Reset flag after chunk creation
            }
          }
        }, 3000); // Wait 3 seconds after last speech activity
      }
    };

    recognition.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
      // Only set error and stop for serious errors, not network issues
      if (event.error === 'network' || event.error === 'audio-capture' || event.error === 'not-allowed') {
        setError(`Błąd rozpoznawania mowy: ${event.error}`);
        setIsListening(false);
      }
      // For other errors like 'no-speech', let the onend handler restart
    };

    recognition.onend = () => {
      // Only show as stopped if user manually stopped or there's an error
      if (manualStopRef.current || error) {
        setIsListening(false);
      } else {
        // API stopped due to timeout - restart seamlessly to continue listening
        setTimeout(() => {
          if (recognitionRef.current && !manualStopRef.current && !error) {
            console.log('Seamlessly restarting speech recognition due to API timeout...');
            try {
              // Don't reset processedResultsLength to maintain continuity
              recognitionRef.current.start();
            } catch (err) {
              console.error('Auto-restart failed:', err);
              setError('Transkrypcja została przerwana. Naciśnij "Rozpocznij Nagrywanie" aby kontynuować.');
              setIsListening(false);
            }
          }
        }, 100); // Very short delay to restart quickly
      }
    };

    return () => {
      if (recognition) {
        recognition.stop();
      }
    };
  }, [lectureId, isOnline, userId, error]);

  // Auto-sync when coming online
  useEffect(() => {
    if (isOnline) {
      syncService.autoSync();
      updateOfflineQueueCount();
    }
  }, [isOnline]);

  // Session timer
  useEffect(() => {
    let interval;
    if (isListening && sessionStartTime.current) {
      interval = setInterval(() => {
        setSessionDuration(Math.floor((Date.now() - sessionStartTime.current) / 1000));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isListening]);

  // Update offline queue count
  const updateOfflineQueueCount = async () => {
    try {
      const stats = await offlineStorage.getStorageStats();
      setOfflineQueueCount(stats.transcriptions.unsynced + stats.syncQueue);
    } catch (error) {
      console.error('Error updating offline queue count:', error);
    }
  };

  // Load offline queue count on component mount
  useEffect(() => {
    updateOfflineQueueCount();
  }, []);

  const startListening = async () => {
    if (recognitionRef.current && !isListening) {
      try {
        // Initialize transcription document if it doesn't exist
        if (lectureId) {
          const initialData = {
            rawText: '',
            correctedText: '',
            createdBy: userId,
            createdAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString(),
            chunks: []
          };

          if (isOnline) {
            try {
              const transcriptionDoc = doc(db, 'transcriptions', lectureId);
              await setDoc(transcriptionDoc, {
                ...initialData,
                createdAt: serverTimestamp(),
                lastUpdated: serverTimestamp()
              }, { merge: true });
            } catch (err) {
              console.error('Error initializing transcription online, storing offline:', err);
              await syncService.storeOfflineTranscription(lectureId, initialData, userId);
              updateOfflineQueueCount();
            }
          } else {
            // Store offline initialization
            await syncService.storeOfflineTranscription(lectureId, initialData, userId);
            updateOfflineQueueCount();
          }
        }

        transcriptRef.current = '';
        setTranscript('');
        setInterimTranscript('');
        setError(''); // Clear any previous errors
        manualStopRef.current = false; // Reset manual stop flag
        lastStoredTranscriptRef.current = ''; // Reset stored transcript tracking
        isCreatingChunk.current = false; // Reset chunk creation flag
        processedResultsLength.current = 0; // Reset processed results counter
        if (chunkTimeoutRef.current) {
          clearTimeout(chunkTimeoutRef.current);
          chunkTimeoutRef.current = null;
        }
        sessionStartTime.current = Date.now(); // Start session timer
        setSessionDuration(0);
        recognitionRef.current.start();
      } catch (err) {
        setError('Błąd podczas uruchamiania transkrypcji: ' + err.message);
      }
    }
  };

  const stopListening = () => {
    if (recognitionRef.current && isListening) {
      manualStopRef.current = true; // Mark as manual stop
      // Clear any pending chunk timeout
      if (chunkTimeoutRef.current) {
        clearTimeout(chunkTimeoutRef.current);
        chunkTimeoutRef.current = null;
      }
      recognitionRef.current.stop();
    }
  };

  const clearTranscript = () => {
    setTranscript('');
    setInterimTranscript('');
    transcriptRef.current = '';
  };

  if (error && error.includes('nie jest obsługiwane')) {
    return (
      <div className="speech-error">
        <p>{error}</p>
        <p>Proszę użyć przeglądarki Chrome, Edge lub Safari aby uzyskać obsługę rozpoznawania mowy.</p>
      </div>
    );
  }

  return (
    <div className="speech-recognition">
      {/* Offline status banner */}
      {!isOnline && (
        <div className="offline-banner">
          ⚠️ Tryb offline - transkrypcja będzie zsynchronizowana po przywróceniu połączenia
        </div>
      )}

      {/* Offline queue info */}
      {offlineQueueCount > 0 && (
        <div className="offline-queue-info">
          <strong>Oczekuje na synchronizację: {offlineQueueCount} elementów</strong>
          {isOnline ? 'Synchronizowanie w toku...' : 'Będzie zsynchronizowane po połączeniu z internetem'}
        </div>
      )}

      <div className="controls">
        <button
          onClick={startListening}
          disabled={isListening}
          className={`start-btn ${isListening ? 'disabled' : ''}`}
        >
          {isListening ? 'Nasłuchiwanie...' : 'Rozpocznij Nagrywanie'}
          {!isOnline && <span className="offline-indicator">OFFLINE</span>}
        </button>

        <button
          onClick={stopListening}
          disabled={!isListening}
          className={`stop-btn ${!isListening ? 'disabled' : ''}`}
        >
          Zatrzymaj Nagrywanie
        </button>

        <button onClick={clearTranscript} className="clear-btn">
          Wyczyść
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="transcript-container">
        <div className="transcript">
          {transcript}
          <span className="interim">{interimTranscript}</span>
        </div>
        {!isOnline && transcript && (
          <div className="offline-save-notice">
            💾 Transkrypcja zapisywana lokalnie
          </div>
        )}
      </div>

      {isListening && (
        <div className="listening-indicator">
          🎤 Nasłuchiwanie...
          <span className="session-info">
            ⏱️ {Math.floor(sessionDuration / 60)}:{(sessionDuration % 60).toString().padStart(2, '0')}
          </span>
          {!isOnline && <span className="offline-indicator">OFFLINE</span>}
        </div>
      )}
    </div>
  );
}

export default SpeechRecognition;