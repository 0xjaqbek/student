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
  const recognitionRef = useRef(null);
  const transcriptRef = useRef('');
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
      let finalTranscript = '';
      let interim = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript + ' ';
        } else {
          interim += transcript;
        }
      }

      if (finalTranscript) {
        const newTranscript = transcriptRef.current + finalTranscript;
        transcriptRef.current = newTranscript;
        setTranscript(newTranscript);

        // Update transcription (online or offline)
        if (lectureId) {
          // Only create a new chunk for the new final transcript, not the entire text
          const newChunk = {
            id: Date.now(),
            text: finalTranscript.trim(),
            timestamp: new Date().toISOString()
          };

          const transcriptionData = {
            rawText: newTranscript,
            lastUpdated: new Date().toISOString(),
            newChunk: newChunk // Send only the new chunk instead of regenerating all chunks
          };

          if (isOnline) {
            // Try to update Firebase directly
            try {
              const transcriptionDoc = doc(db, 'transcriptions', lectureId);
              await updateDoc(transcriptionDoc, {
                rawText: transcriptionData.rawText,
                lastUpdated: serverTimestamp(),
                chunks: arrayUnion(transcriptionData.newChunk) // Add only the new chunk
              });
            } catch (err) {
              console.error('Error updating transcription online, storing offline:', err);
              // Store offline if online update fails
              await syncService.storeOfflineTranscription(lectureId, transcriptionData, userId);
              updateOfflineQueueCount();
            }
          } else {
            // Store offline when offline
            await syncService.storeOfflineTranscription(lectureId, transcriptionData, userId);
            updateOfflineQueueCount();
          }
        }
      }

      setInterimTranscript(interim);
    };

    recognition.onerror = (event) => {
      setError(`Błąd rozpoznawania mowy: ${event.error}`);
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
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
        recognitionRef.current.start();
      } catch (err) {
        setError('Błąd podczas uruchamiania transkrypcji: ' + err.message);
      }
    }
  };

  const stopListening = () => {
    if (recognitionRef.current && isListening) {
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
          {!isOnline && <span className="offline-indicator">OFFLINE</span>}
        </div>
      )}
    </div>
  );
}

export default SpeechRecognition;