import { useState, useEffect } from 'react';
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import { auth, googleProvider } from '../firebase';
import { isAdmin } from '../utils/admin';

function Auth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const signInWithGoogle = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error('Error signing in with Google:', error);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  if (loading) {
    return <div className="loading">Ładowanie...</div>;
  }

  if (!user) {
    return (
      <div className="auth-container">
        <h1>Aplikacja do Transkrypcji Wykładów</h1>
        <p>Zaloguj się, aby rozpocząć transkrypcję wykładów i dzielić się wiedzą</p>
        <button onClick={signInWithGoogle} className="google-signin-btn">
          Zaloguj się z Google
        </button>
      </div>
    );
  }

  return (
    <div className="user-info">
      <div className="user-profile">
        <img src={user.photoURL} alt="Profil" className="profile-img" />
        <span>Witaj, {user.displayName}</span>
        {isAdmin(user) && (
          <span className="admin-indicator">ADMIN</span>
        )}
      </div>
      <button onClick={handleSignOut} className="signout-btn">
        Wyloguj się
      </button>
    </div>
  );
}

export default Auth;