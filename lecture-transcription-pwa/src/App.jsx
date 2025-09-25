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
  const [currentView, setCurrentView] = useState('menu'); // 'menu', 'add-lecture', 'browse-lectures', 'record', 'view'
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

  const renderMainMenu = () => (
    <div className="main-menu">
      <h2>Co chcesz zrobić?</h2>
      <div className="menu-buttons">
        <button
          className="menu-button add-lecture"
          onClick={() => setCurrentView('add-lecture')}
        >
          <span className="menu-icon">➕</span>
          <span className="menu-title">Dodaj Wykład</span>
          <span className="menu-description">Utwórz nowy wykład i rozpocznij transkrypcję</span>
        </button>

        <button
          className="menu-button browse-lectures"
          onClick={() => setCurrentView('browse-lectures')}
        >
          <span className="menu-icon">📚</span>
          <span className="menu-title">Przeglądaj Wykłady</span>
          <span className="menu-description">Zobacz istniejące wykłady i transkrypcje</span>
        </button>
      </div>
    </div>
  );

  const renderHeader = () => (
    <header className="app-header">
      <div className="header-content">
        {currentView !== 'menu' && (
          <button
            className="back-button"
            onClick={() => {
              setCurrentView('menu');
              setSelectedLectureId(null);
            }}
          >
            ← Powrót do Menu
          </button>
        )}

        <h1>Aplikacja do Transkrypcji Wykładów</h1>

        <div className="header-right">
          {!isOnline && <span className="offline-indicator">OFFLINE</span>}
          {isSyncing && <span className="sync-indicator">SYNC</span>}
          <Auth />
        </div>
      </div>
    </header>
  );

  return (
    <div className="app">
      {renderHeader()}

      <main className="app-main">
        {currentView === 'menu' && renderMainMenu()}

        {currentView === 'add-lecture' && (
          <div className="add-lecture-section">
            <h2>Dodaj Nowy Wykład</h2>
            <LectureManager
              user={user}
              onSelectLecture={(lectureId) => {
                setSelectedLectureId(lectureId);
                setCurrentView('record');
              }}
              selectedLectureId={selectedLectureId}
              mode="add"
            />
          </div>
        )}

        {currentView === 'browse-lectures' && (
          <div className="browse-lectures-section">
            <h2>Przeglądaj Wykłady</h2>
            <LectureManager
              user={user}
              onSelectLecture={(lectureId) => {
                setSelectedLectureId(lectureId);
                setCurrentView('view');
              }}
              selectedLectureId={selectedLectureId}
              mode="browse"
            />

            {selectedLectureId && (
              <div className="lecture-actions">
                <button
                  className="action-button record"
                  onClick={() => setCurrentView('record')}
                >
                  🎤 Nagraj Transkrypcję
                </button>
                <button
                  className="action-button view"
                  onClick={() => setCurrentView('view')}
                >
                  👁️ Zobacz Transkrypcję
                </button>
              </div>
            )}
          </div>
        )}

        {currentView === 'record' && selectedLectureId && (
          <div className="record-section">
            <h2>Nagrywanie Wykładu</h2>
            <SpeechRecognition
              lectureId={selectedLectureId}
              userId={user.uid}
            />
          </div>
        )}

        {currentView === 'view' && selectedLectureId && (
          <div className="view-section">
            <h2>Transkrypcja Wykładu</h2>
            <TranscriptionViewer
              lectureId={selectedLectureId}
              user={user}
            />
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
