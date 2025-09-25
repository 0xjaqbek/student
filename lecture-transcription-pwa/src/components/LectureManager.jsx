import { useState, useEffect } from 'react';
import { collection, addDoc, query, orderBy, onSnapshot, serverTimestamp, doc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { isAdmin, checkAdminPermission } from '../utils/admin';

function LectureManager({ user, onSelectLecture, selectedLectureId, mode = 'browse' }) {
  const [lectures, setLectures] = useState([]);
  const [showCreateForm, setShowCreateForm] = useState(mode === 'add');
  const [newLecture, setNewLecture] = useState({ name: '', topic: '' });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'lectures'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const lecturesList = [];
      querySnapshot.forEach((doc) => {
        lecturesList.push({ id: doc.id, ...doc.data() });
      });
      setLectures(lecturesList);
    });

    return () => unsubscribe();
  }, []);

  const createLecture = async (e) => {
    e.preventDefault();
    if (!newLecture.name.trim() || !newLecture.topic.trim()) return;

    setLoading(true);
    try {
      const docRef = await addDoc(collection(db, 'lectures'), {
        name: newLecture.name.trim(),
        topic: newLecture.topic.trim(),
        createdBy: user.uid,
        createdByName: user.displayName,
        createdAt: serverTimestamp(),
        isPublic: true
      });

      setNewLecture({ name: '', topic: '' });
      setShowCreateForm(false);
      onSelectLecture(docRef.id);
    } catch (error) {
      console.error('Error creating lecture:', error);
    }
    setLoading(false);
  };

  const deleteLecture = async (lectureId, lectureName) => {
    if (!checkAdminPermission(user, 'delete lecture')) {
      alert('Brak uprawnień administratora do usuwania wykładów.');
      return;
    }

    const confirmMessage = `Czy na pewno chcesz usunąć wykład "${lectureName}"? Ta operacja usunie również wszystkie związane transkrypcje i jest nieodwracalna.`;

    if (!confirm(confirmMessage)) {
      return;
    }

    setLoading(true);
    try {
      // Delete the lecture document
      await deleteDoc(doc(db, 'lectures', lectureId));

      // Delete the associated transcription document
      try {
        await deleteDoc(doc(db, 'transcriptions', lectureId));
      } catch (transcriptionError) {
        console.log('No transcription found for this lecture:', transcriptionError);
      }

      alert(`Wykład "${lectureName}" został usunięty.`);

      // Clear selection if the deleted lecture was selected
      if (selectedLectureId === lectureId) {
        onSelectLecture(null);
      }
    } catch (error) {
      console.error('Error deleting lecture:', error);
      alert('Wystąpił błąd podczas usuwania wykładu. Spróbuj ponownie.');
    }
    setLoading(false);
  };

  return (
    <div className="lecture-manager">
      <div className="lecture-header">
        {mode === 'add' ? (
          <h3>Utwórz nowy wykład i rozpocznij transkrypcję</h3>
        ) : (
          <>
            <h3>Wybierz wykład</h3>
            <button
              onClick={() => setShowCreateForm(!showCreateForm)}
              className="create-btn"
            >
              {showCreateForm ? 'Anuluj' : 'Utwórz Nowy Wykład'}
            </button>
          </>
        )}
      </div>

      {showCreateForm && (
        <form onSubmit={createLecture} className="create-lecture-form">
          <div className="form-group">
            <label>Nazwa wykładu:</label>
            <input
              type="text"
              value={newLecture.name}
              onChange={(e) => setNewLecture({ ...newLecture, name: e.target.value })}
              placeholder="np. Wprowadzenie do Reacta"
              required
            />
          </div>
          <div className="form-group">
            <label>Temat/Przedmiot:</label>
            <input
              type="text"
              value={newLecture.topic}
              onChange={(e) => setNewLecture({ ...newLecture, topic: e.target.value })}
              placeholder="np. Informatyka, Matematyka"
              required
            />
          </div>
          <button type="submit" disabled={loading} className="submit-btn">
            {loading ? 'Tworzenie...' : 'Utwórz Wykład'}
          </button>
        </form>
      )}

      <div className="lectures-list">
        {lectures.length === 0 ? (
          <p className="no-lectures">Brak wykładów. Utwórz pierwszy!</p>
        ) : (
          lectures.map((lecture) => (
            <div
              key={lecture.id}
              className={`lecture-item ${selectedLectureId === lecture.id ? 'selected' : ''}`}
            >
              <div
                className="lecture-info"
                onClick={() => onSelectLecture(lecture.id)}
              >
                <h3>{lecture.name}</h3>
                <p className="topic">{lecture.topic}</p>
                <div className="meta">
                  <span>przez {lecture.createdByName}</span>
                  <span>{lecture.createdAt?.toDate?.()?.toLocaleDateString?.('pl-PL') || 'Niedawno'}</span>
                </div>
              </div>
              {isAdmin(user) && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteLecture(lecture.id, lecture.name);
                  }}
                  className="delete-btn lecture-delete-btn"
                  disabled={loading}
                  title="Usuń wykład (tylko admin)"
                >
                  ✕
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default LectureManager;