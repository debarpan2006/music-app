# 🎵 Dil Se Suno (Play with Debarpan)

[![Vercel](https://img.shields.io/badge/Deployed%20on-Vercel-black?style=for-the-badge&logo=vercel)](https://vercel.com)
[![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)](https://reactjs.org/)
[![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)

**Dil Se Suno** is a premium, full-stack music streaming experience designed for the modern listener. It blends high-quality audio streams from JioSaavn with the vast catalogues of YouTube Music and Apple Music, all powered by state-of-the-art AI for a truly personalized journey.

> [!TIP]
> This project is designed as a hybrid application, offering a seamless experience across Web and Android platforms.

---

## ✨ Key Features

### 🔍 Unified Search & Playback
- **Infinite Catalogue**: Search across JioSaavn, YouTube Music, and Apple Music from a single interface.
- **Auto-Bridging**: Automatically finds the best quality stream for any track from any source.
- **Cross-Platform Support**: Stream synced lyrics and metadata regardless of the source.

### 🤖 AI-Powered Personalization
- **Last.fm Powered Discovery**: Real-time integration with **Last.fm Global Discovery API** to map artist similarities and trends on a global scale.
- **Smart Recommendations**: Utilizing **NVIDIA Llama 3.1 (70B)** to analyze your listening habits and suggest tracks that match your mood, time of day, and history, now enhanced with real-time Last.fm context.
- **Dynamic Playlists**: "For You" feeds that evolve in real-time as you listen.
- **Artist Similarity Mapping**: Deep integration of artist relationships to help you discover your next favorite creator.

### 📝 Lyrics & Transliteration
- **Live Synced Lyrics**: Real-time lyrics powered by JioSaavn and LRCLIB.
- **AI Transliteration**: Instantly convert Devanagari (Hindi) lyrics to Roman script (English pronunciation) using AI for a seamless karaoke experience.

### 📊 Monthly Replay (Wrapped)
- **Visual Insights**: Interactive listening statistics including top artists, tracks, and genres.
- **Shareable Stories**: Generate beautiful, Instagram-ready images of your monthly music journey with a single click.

### 📱 Android Integration
- **Hybrid Native App**: Built with **Capacitor**, providing a full native Android experience with local notifications and background playback support.
- **APK Ready**: Pre-compiled builds for both release and debug environments.

---

## 🛠️ Technology Stack

| Layer | Technology |
| :--- | :--- |
| **Frontend** | React 18, Vite, Custom Glassmorphism UI |
| **Backend** | Node.js, Express |
| **AI / LLM** | NVIDIA Llama 3.1 70B (via NVIDIA NIM) |
| **Mobile** | Capacitor 6, Android Studio |
| **APIs** | JioSaavn, YTMusic-API, Last.fm, LRCLIB |
| **Deployment** | Vercel (Monorepo) |

---

## 🚀 Getting Started

### Prerequisites
- Node.js (v18 or higher)
- npm or yarn
- Android Studio (for Android builds)

### 1. Clone & Install
```bash
git clone <repository-url>
cd music-app
```

### 2. Backend Setup
```bash
cd backend
npm install
# Create a .env file with your API keys (YT_AUTH, etc.)
npm run dev
```

### 3. Frontend Setup
```bash
cd ../frontend
npm install
npm run dev
```

### 4. Android Build (Optional)
```bash
npx cap sync android
npx cap open android
```

---

## 🏗️ Project Architecture
```text
music-app/
├── backend/            # Express server & AI logic
├── frontend/           # React SPA
│   ├── src/            # Component & UI logic
│   └── android/         # Capacitor Android project
├── vercel.json         # Monorepo deployment config
└── ...                 # APK builds & assets
```

---

## 🎨 UI Aesthetics
The app features a **Premium Dark Mode** with **Glassmorphism** effects, vibrant gradients, and smooth micro-animations, ensuring a high-end visual experience that rivals industry leaders.

---

## 📝 License
Created with ❤️ by **Debarpan**.
