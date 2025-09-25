import { useState, useEffect } from 'react';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { isAdmin, checkAdminPermission } from '../utils/admin';

function TranscriptionViewer({ lectureId, user }) {
  const [transcription, setTranscription] = useState(null);
  const [viewMode, setViewMode] = useState('raw'); // 'raw' or 'corrected'
  const [correctedText, setCorrectedText] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!lectureId) return;

    const unsubscribe = onSnapshot(doc(db, 'transcriptions', lectureId), (doc) => {
      if (doc.exists()) {
        setTranscription(doc.data());
        setCorrectedText(doc.data().correctedText || '');
      }
    });

    return () => unsubscribe();
  }, [lectureId]);

  const saveCorrectedText = async () => {
    if (!lectureId) return;

    setLoading(true);
    try {
      await updateDoc(doc(db, 'transcriptions', lectureId), {
        correctedText: correctedText.trim(),
        correctedBy: user.uid,
        correctedByName: user.displayName,
        correctedAt: new Date()
      });
      setIsEditing(false);
    } catch (error) {
      console.error('Error saving corrected text:', error);
    }
    setLoading(false);
  };

  const exportAsText = () => {
    const textToExport = viewMode === 'raw'
      ? transcription?.rawText || ''
      : transcription?.correctedText || '';

    const blob = new Blob([textToExport], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lecture-${lectureId}-${viewMode}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const deleteTranscription = async (type) => {
    if (!checkAdminPermission(user, 'delete transcription')) {
      alert('Brak uprawnień administratora do usuwania transkrypcji.');
      return;
    }

    const confirmMessage = type === 'raw'
      ? 'Czy na pewno chcesz usunąć surową transkrypcję? Ta operacja jest nieodwracalna.'
      : 'Czy na pewno chcesz usunąć poprawione notatki? Ta operacja jest nieodwracalna.';

    if (!confirm(confirmMessage)) {
      return;
    }

    setLoading(true);
    try {
      const updateData = {};
      if (type === 'raw') {
        updateData.rawText = '';
        updateData.chunks = [];
      } else if (type === 'corrected') {
        updateData.correctedText = '';
        updateData.correctedBy = null;
        updateData.correctedByName = null;
        updateData.correctedAt = null;
      }

      await updateDoc(doc(db, 'transcriptions', lectureId), updateData);

      if (type === 'corrected') {
        setCorrectedText('');
        setIsEditing(false);
      }

      alert(`${type === 'raw' ? 'Surowa transkrypcja' : 'Poprawione notatki'} została usunięta.`);
    } catch (error) {
      console.error('Error deleting transcription:', error);
      alert('Wystąpił błąd podczas usuwania. Spróbuj ponownie.');
    }
    setLoading(false);
  };

  if (!transcription) {
    return (
      <div className="transcription-viewer">
        <p>Wybierz wykład aby zobaczyć transkrypcję lub rozpocznij nowe nagrywanie.</p>
      </div>
    );
  }

  return (
    <div className="transcription-viewer">
      <div className="transcription-header">
        <div className="view-controls">
          <button
            onClick={() => setViewMode('raw')}
            className={viewMode === 'raw' ? 'active' : ''}
          >
            Surowa Transkrypcja
          </button>
          <button
            onClick={() => setViewMode('corrected')}
            className={viewMode === 'corrected' ? 'active' : ''}
          >
            Poprawione Notatki
          </button>
        </div>

        <div className="action-buttons">
          <button onClick={exportAsText} className="export-btn">
            Eksportuj jako TXT
          </button>
          {viewMode === 'corrected' && (
            <button
              onClick={() => setIsEditing(!isEditing)}
              className="edit-btn"
            >
              {isEditing ? 'Anuluj Edycję' : 'Edytuj Notatki'}
            </button>
          )}
          {isAdmin(user) && (
            <button
              onClick={() => deleteTranscription(viewMode)}
              className="delete-btn"
              disabled={loading}
            >
              {viewMode === 'raw' ? 'Usuń Surową' : 'Usuń Poprawione'}
            </button>
          )}
        </div>
      </div>

      <div className="transcription-content">
        {viewMode === 'raw' ? (
          <div className="raw-transcription">
            <div className="content">
              {transcription.chunks && transcription.chunks.length > 0 ? (
                <div className="chunks-display">
                  {transcription.chunks
                    .filter((chunk, index, array) => {
                      // Remove duplicate chunks and empty chunks
                      if (!chunk.text || chunk.text.trim() === '') return false;
                      // Keep only chunks that aren't duplicates of previous ones
                      return index === 0 || chunk.text !== array[index - 1]?.text;
                    })
                    .map((chunk, index) => (
                    <div key={chunk.id || index} className="chunk">
                      <span className="chunk-text">{chunk.text}</span>
                      <span className="chunk-time">
                        {new Date(chunk.timestamp).toLocaleTimeString('pl-PL')}
                      </span>
                    </div>
                  ))}
                </div>
              ) : transcription.rawText ? (
                <div className="raw-text">
                  {transcription.rawText.replace(/\s+/g, ' ').trim()}
                </div>
              ) : (
                'Brak dostępnej transkrypcji.'
              )}
            </div>
            <div className="meta">
              Ostatnio zaktualizowano: {transcription.lastUpdated?.toDate?.()?.toLocaleString?.('pl-PL') || 'Nieznane'}
            </div>
          </div>
        ) : (
          <div className="corrected-transcription">
            {isEditing ? (
              <div className="edit-mode">
                <textarea
                  value={correctedText}
                  onChange={(e) => setCorrectedText(e.target.value)}
                  placeholder="Wprowadź poprawione notatki tutaj..."
                  className="edit-textarea"
                />
                <div className="edit-actions">
                  <button onClick={saveCorrectedText} disabled={loading} className="save-btn">
                    {loading ? 'Zapisywanie...' : 'Zapisz Zmiany'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="view-mode">
                <div className="content">
                  {transcription.correctedText || 'Brak poprawionych notatek. Kliknij "Edytuj Notatki" aby je dodać.'}
                </div>
                {transcription.correctedText && (
                  <div className="meta">
                    Poprawione przez: {transcription.correctedByName || 'Nieznany'} dnia{' '}
                    {transcription.correctedAt?.toDate?.()?.toLocaleString?.('pl-PL') || 'Nieznana data'}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default TranscriptionViewer;