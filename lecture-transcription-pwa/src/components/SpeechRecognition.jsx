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
  const [restartCount, setRestartCount] = useState(0);
  const recognitionRef = useRef(null);
  const transcriptRef = useRef('');
  const manualStopRef = useRef(false);
  const sessionStartTime = useRef(null);
  const lastChunkTextRef = useRef('');
  const chunkTimeoutRef = useRef(null);
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

    recognition.onstart = () => {
      setIsListening(true);
      setError('');
    };

    recognition.onresult = async (event) => {
      let interim = '';
      let finalTranscript = '';

      // Process all results to get current state
      for (let i = 0; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript + ' ';
        } else {
          interim += transcript;
        }
      }

      // Update display immediately
      if (finalTranscript) {
        transcriptRef.current = finalTranscript;
        setTranscript(finalTranscript);
      }
      setInterimTranscript(interim);

      // Debounced chunk creation - only create chunk after 2 seconds of no new results
      if (finalTranscript && finalTranscript !== lastChunkTextRef.current) {
        // Clear previous timeout
        if (chunkTimeoutRef.current) {
          clearTimeout(chunkTimeoutRef.current);
        }

        // Set new timeout to create chunk
        chunkTimeoutRef.current = setTimeout(async () => {
          const currentText = transcriptRef.current.trim();
          const lastText = lastChunkTextRef.current.trim();

          // Only create chunk if we have genuinely new content
          if (currentText && currentText !== lastText && currentText.length > lastText.length) {
            // Extract only the new part
            const newContent = currentText.substring(lastText.length).trim();

            if (newContent && lectureId) {
              lastChunkTextRef.current = currentText;

              const newChunk = {
                id: Date.now(),
                text: newContent,
                timestamp: new Date().toISOString()
              };

              const transcriptionData = {
                rawText: currentText,
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
            }
          }
        }, 2000); // Wait 2 seconds before creating chunk
      }
    };

    recognition.onerror = (event) => {
      setError(`Błąd rozpoznawania mowy: ${event.error}`);
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);

      // Auto-restart if user hasn't manually stopped and no errors
      if (!manualStopRef.current && !error) {
        setTimeout(() => {
          if (recognitionRef.current && !manualStopRef.current) {
            console.log('Auto-restarting speech recognition...');
            try {
              setRestartCount(prev => prev + 1);
              setIsListening(true);
              recognitionRef.current.start();
            } catch (err) {
              console.error('Auto-restart failed:', err);
              setError('Transkrypcja została przerwana. Naciśnij "Rozpocznij Nagrywanie" aby kontynuować.');
              setIsListening(false);
            }
          }
        }, 1000); // Wait 1 second before restarting
      }
    };

    return () => {
      if (recognition) {
        recognition.stop();
      }
    };
  }, [lectureId, isOnline, userId]);

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
        manualStopRef.current = false; // Reset manual stop flag
        lastChunkTextRef.current = ''; // Reset last chunk tracking
        if (chunkTimeoutRef.current) {
          clearTimeout(chunkTimeoutRef.current);
          chunkTimeoutRef.current = null;
        }
        sessionStartTime.current = Date.now(); // Start session timer
        setSessionDuration(0);
        setRestartCount(0);
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
            {restartCount > 0 && <span className="restart-info">🔄 {restartCount}</span>}
          </span>
          {!isOnline && <span className="offline-indicator">OFFLINE</span>}
        </div>
      )}
    </div>
  );
}

export default SpeechRecognition;