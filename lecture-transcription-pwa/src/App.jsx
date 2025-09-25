import { useState, useEffect } from 'react';
import { useAuth } from './hooks/useAuth';
import { useNetworkStatus } from './hooks/useNetworkStatus';
import Auth from './components/Auth';
import LectureManager from './components/LectureManager';
import SpeechRecognition from './components/SpeechRecognition';
import TranscriptionViewer from './components/TranscriptionViewer';
import syncService from './services/syncService';
import './App.css';

function App() {
  const { user, loading } = useAuth();
  const { isOnline } = useNetworkStatus();
  const [selectedLectureId, setSelectedLectureId] = useState(null);
  const [activeTab, setActiveTab] = useState('browse'); // 'browse', 'record', 'view'
  const [isSyncing, setIsSyncing] = useState(false);

  // Handle sync status
  useEffect(() => {
    const handleSyncEvent = (event) => {
      switch (event) {
        case 'sync_start':
          setIsSyncing(true);
          break;
        case 'sync_complete':
        case 'sync_error':
          setIsSyncing(false);
          break;
      }
    };

    syncService.addSyncListener(handleSyncEvent);

    return () => {
      syncService.removeSyncListener(handleSyncEvent);
    };
  }, []);

  // Auto-sync when coming online
  useEffect(() => {
    if (isOnline && user) {
      syncService.autoSync();
    }
  }, [isOnline, user]);

  if (loading) {
    return <div className="loading">Ładowanie...</div>;
  }

  if (!user) {
    return <Auth />;
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Aplikacja do Transkrypcji Wykładów</h1>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {!isOnline && <span className="offline-indicator">OFFLINE</span>}
          {isSyncing && <span className="sync-indicator">SYNC</span>}
          <Auth />
        </div>
      </header>

      <nav className="app-nav">
        <button
          onClick={() => setActiveTab('browse')}
          className={activeTab === 'browse' ? 'active' : ''}
        >
          Przeglądaj Wykłady
        </button>
        <button
          onClick={() => setActiveTab('record')}
          className={activeTab === 'record' ? 'active' : ''}
          disabled={!selectedLectureId}
        >
          Nagraj
        </button>
        <button
          onClick={() => setActiveTab('view')}
          className={activeTab === 'view' ? 'active' : ''}
          disabled={!selectedLectureId}
        >
          Zobacz Transkrypcję
        </button>
      </nav>

      <main className="app-main">
        {activeTab === 'browse' && (
          <LectureManager
            user={user}
            onSelectLecture={(lectureId) => {
              setSelectedLectureId(lectureId);
              setActiveTab('record');
            }}
            selectedLectureId={selectedLectureId}
          />
        )}

        {activeTab === 'record' && selectedLectureId && (
          <div className="record-section">
            <h2>Nagrywanie Wykładu</h2>
            <SpeechRecognition
              lectureId={selectedLectureId}
              userId={user.uid}
            />
          </div>
        )}

        {activeTab === 'view' && selectedLectureId && (
          <TranscriptionViewer
            lectureId={selectedLectureId}
            user={user}
          />
        )}

        {!selectedLectureId && activeTab !== 'browse' && (
          <div className="no-lecture-selected">
            <p>Proszę najpierw wybrać wykład z zakładki Przeglądaj.</p>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
