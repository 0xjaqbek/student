# Aplikacja do Transkrypcji Wykładów (PWA)

Progressive Web App do transkrypcji wykładów w czasie rzeczywistym i współpracy przy tworzeniu notatek. Zbudowana z React, Vite i Firebase.

## Funkcje

- 🎤 **Transkrypcja w czasie rzeczywistym** - Na żywo przy użyciu Web Speech API (obsługa języka polskiego)
- 🔐 **Uwierzytelnianie Google** - Bezpieczne logowanie przez Firebase Auth
- 📚 **Wspólna baza wiedzy** - Wszystkie wykłady dostępne dla wszystkich użytkowników
- 📝 **Podwójny system notatek** - Surowa transkrypcja + poprawione notatki
- 🚀 **Progressive Web App** - Działa offline i może być zainstalowana
- 📱 **Responsywny design** - Działa na komputerze i urządzeniach mobilnych
- 📤 **Opcje eksportu** - Pobieranie transkrypcji jako pliki TXT

## Setup Instructions

### 1. Clone the Repository

```bash
git clone <your-repo-url>
cd lecture-transcription-pwa
npm install
```

### 2. Firebase Setup

1. **Create a Firebase Project**
   - Go to [Firebase Console](https://console.firebase.google.com/)
   - Create a new project
   - Enable Google Analytics (optional)

2. **Enable Authentication**
   - Go to Authentication > Sign-in method
   - Enable Google as a sign-in provider
   - Add your domain to authorized domains

3. **Setup Firestore Database**
   - Go to Firestore Database
   - Create database in production mode
   - Set up the following security rules:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Helper function to check if user is admin
    function isAdmin() {
      return request.auth != null && request.auth.token.email == 'jaqbek.eth@gmail.com';
    }

    // Lectures - readable by all authenticated users, writable by creators, deletable by admin
    match /lectures/{document} {
      allow read: if request.auth != null;
      allow create: if request.auth != null && request.auth.uid == request.resource.data.createdBy;
      allow update: if request.auth != null && request.auth.uid == resource.data.createdBy;
      allow delete: if request.auth != null && (request.auth.uid == resource.data.createdBy || isAdmin());
    }

    // Transcriptions - readable by all authenticated users, writable by all, deletable by admin
    match /transcriptions/{document} {
      allow read, write: if request.auth != null;
      allow delete: if request.auth != null && isAdmin();
    }
  }
}
```

4. **Get Firebase Configuration**
   - Go to Project Settings > General
   - Scroll down to "Your apps" section
   - Click "Web app" icon and register your app
   - Copy the config object

### 3. Environment Variables

1. Create a `.env` file in the root directory:

```bash
cp .env.example .env
```

2. Fill in your Firebase configuration:

```env
VITE_FIREBASE_API_KEY=your-api-key-here
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=your-app-id
```

### 4. PWA Icons (Optional)

Add your own PWA icons to the `public` folder:
- `icon-192x192.png` - 192x192 pixels
- `icon-512x512.png` - 512x512 pixels
- `favicon.ico` - Standard favicon

### 5. Development

```bash
npm run dev
```

The app will be available at `http://localhost:5173`

### 6. Build and Deploy

```bash
npm run build
npm run deploy
```

## Browser Compatibility

### Speech Recognition Support
- ✅ Chrome/Chromium (recommended)
- ✅ Edge
- ✅ Safari (iOS 14.5+)
- ❌ Firefox (not supported)

### PWA Support
- ✅ All modern browsers
- ✅ Mobile browsers (iOS Safari, Android Chrome)

## How to Use

### 1. Authentication
- Click "Sign in with Google" to authenticate
- Your profile will appear in the header

### 2. Creating a Lecture
1. Go to "Browse Lectures" tab
2. Click "Create New Lecture"
3. Enter lecture name and topic
4. Click "Create Lecture"

### 3. Recording
1. Select a lecture from the list
2. Click "Record" tab (automatically opened after creation)
3. Click "Start Recording" to begin transcription
4. Speak clearly - the app will transcribe in real-time
5. Click "Stop Recording" when done

### 4. Viewing and Editing
1. Select a lecture and click "View Transcription"
2. Toggle between "Raw Transcription" and "Corrected Notes"
3. Click "Edit Notes" to add corrected/cleaned up version
4. Use "Export as TXT" to download

## Project Structure

```
src/
├── components/
│   ├── Auth.jsx              # Authentication component
│   ├── LectureManager.jsx    # Lecture creation and browsing
│   ├── SpeechRecognition.jsx # Real-time transcription
│   └── TranscriptionViewer.jsx # View and edit transcriptions
├── hooks/
│   └── useAuth.js            # Authentication hook
├── firebase.js               # Firebase configuration
├── App.jsx                   # Main app component
├── App.css                   # Styling
└── main.jsx                  # App entry point
```

## Technology Stack

- **Frontend**: React 19 + Vite
- **Authentication**: Firebase Auth
- **Database**: Firestore
- **Speech Recognition**: Web Speech API
- **PWA**: Vite PWA Plugin + Workbox
- **Deployment**: GitHub Pages

## Browser Requirements

- Speech recognition requires HTTPS in production
- Firefox doesn't support Web Speech API
- Mobile Safari requires user gesture to start recording

## License

MIT License - feel free to use and modify as needed.
