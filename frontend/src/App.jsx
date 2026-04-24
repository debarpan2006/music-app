
import { useState, useRef, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import './App.css';
import './YTMPlayer.css';

// ── IndexedDB Helpers for Offline Storage ──
const DB_NAME = 'MusicOfflineDB';
const getDB = () => new Promise((res, rej) => {
  const req = indexedDB.open(DB_NAME, 1);
  req.onupgradeneeded = () => req.result.createObjectStore('songs');
  req.onsuccess = () => res(req.result);
  req.onerror = () => rej(req.error);
});
const saveOffline = async (id, blob) => {
  const db = await getDB();
  const tx = db.transaction('songs', 'readwrite');
  tx.objectStore('songs').put(blob, id);
  return new Promise((res) => tx.oncomplete = res);
};
const getOffline = async (id) => {
  const db = await getDB();
  const req = db.transaction('songs', 'readonly').objectStore('songs').get(id);
  return new Promise((res) => req.onsuccess = () => res(req.result));
};
// ── API Native Config ──
if (Capacitor.isNativePlatform()) {
  axios.defaults.baseURL = 'https://music-app-three-gules.vercel.app';
}

// ── Time context ─────────────────────────────────────────────────────────
const getTimeContext = () => {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  if (h >= 17 && h < 21) return 'evening';
  return 'night';
};

// ── Decode HTML Entities ──
const decodeText = (text) => {
  if (!text) return '';
  const textarea = document.createElement('textarea');
  textarea.innerHTML = text;
  return textarea.value;
};

const timeGreeting = () => {
  const t = getTimeContext();
  const greetings = {
    morning: 'Good Morning ☀️',
    afternoon: 'Good Afternoon 🌤',
    evening: 'Good Evening 🌆',
    night: 'Good Night 🌙',
  };
  return greetings[t];
};

// ── History (localStorage) ───────────────────────────────────────────────
const HISTORY_KEY = 'playwdebarpan_v3_history';
const MONTHLY_KEY = 'playwdebarpan_monthly';
// ── Robust artist name resolver ───────────────────────────────️
// JioSaavn returns artist info in many different shapes depending on endpoint.
// This helper tries every known format and always returns a clean string.
const resolveArtist = (song) => {
  if (!song) return '';
  // Preferred: structured array
  if (Array.isArray(song.artists?.primary) && song.artists.primary.length > 0)
    return song.artists.primary.map(a => a.name).join(', ');
  // Some endpoints return artists.all instead
  if (Array.isArray(song.artists?.all) && song.artists.all.length > 0)
    return song.artists.all.filter(a => a.role === 'singer' || !a.role).map(a => a.name).join(', ');
  // Flat string fields
  if (typeof song.primaryArtists === 'string' && song.primaryArtists) return song.primaryArtists;
  if (typeof song.artist === 'string' && song.artist) return song.artist;
  if (typeof song.singers === 'string' && song.singers) return song.singers;
  // Fallback: look inside nested artists object
  if (song.artists && typeof song.artists === 'object') {
    const val = Object.values(song.artists).find(v => v && typeof v === 'string');
    if (val) return val;
  }
  return '';
};

const getMonthKey = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

const loadHistory = () => {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || { songs: {}, moods: {}, genres: {} }; }
  catch { return { songs: {}, moods: {}, genres: {} }; }
};

const saveHistory = (h) => {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h)); } catch { }
};

const loadMonthlyStats = () => {
  try { return JSON.parse(localStorage.getItem(MONTHLY_KEY)) || {}; }
  catch { return {}; }
};

const saveMonthlyStats = (stats) => {
  try { localStorage.setItem(MONTHLY_KEY, JSON.stringify(stats)); } catch { }
};

const recordMonthlyPlay = (song, listenedMs = 0) => {
  const stats = loadMonthlyStats();
  const key = getMonthKey();
  if (!stats[key]) stats[key] = { songs: {}, artists: {}, genres: {}, totalMs: 0 };
  const m = stats[key];
  const songName = song.name || 'Unknown';
  let artist = resolveArtist(song);
  if (!artist || artist === '—') artist = 'Unknown';

  const genre = song.genre || '';
  m.songs[songName] = (m.songs[songName] || 0) + 1;

  // Track individual artists separately, ignoring generic "Unknown"
  artist.split(',').map(a => a.trim()).filter(a => a && a !== 'Unknown' && a !== '—').forEach(a => {
    m.artists[a] = (m.artists[a] || 0) + 1;
  });

  if (genre) m.genres[genre] = (m.genres[genre] || 0) + 1;
  m.totalMs = (m.totalMs || 0) + listenedMs;
  saveMonthlyStats(stats);
};

const recordPlay = (history, song, mood = '', genre = '') => {
  const id = song.id;
  const artistName = resolveArtist(song);
  const existing = history.songs[id] || {
    id, name: song.name, artistName, playCount: 0, skipCount: 0,
    lastPlayed: null, mood, genre, totalListenMs: 0,
  };
  existing.playCount += 1;
  existing.lastPlayed = Date.now();
  existing.mood = mood || existing.mood;
  existing.genre = genre || existing.genre;
  existing.artistName = artistName || existing.artistName;
  history.songs[id] = existing;
  if (mood) history.moods[mood] = (history.moods[mood] || 0) + 1;
  if (genre) history.genres[genre] = (history.genres[genre] || 0) + 1;
  return { ...history };
};

const recordSkip = (history, songId) => {
  if (history.songs[songId]) {
    history.songs[songId].skipCount = (history.songs[songId].skipCount || 0) + 1;
  }
  return { ...history };
};

const getTopArtists = (history, n = 5) => {
  const map = {};
  Object.values(history.songs).forEach((s) => {
    if (!s.artistName) return;
    s.artistName.split(', ').forEach((a) => { map[a] = (map[a] || 0) + s.playCount; });
  });
  return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, playCount]) => ({ name, playCount }));
};

const getTopMoods = (history, n = 3) =>
  Object.entries(history.moods || {}).sort((a, b) => b[1] - a[1]).slice(0, n).map(([mood, count]) => ({ mood, count }));

const getRecentSongs = (history, n = 10) =>
  Object.values(history.songs)
    .filter((s) => s.lastPlayed)
    .sort((a, b) => b.lastPlayed - a.lastPlayed)
    .slice(0, n)
    .map((s) => ({ name: s.name, artistName: s.artistName, mood: s.mood }));

// ── Mood / Genre metadata ──────────────────────────────────────────────
const MOOD_EMOJI = {
  happy: '😊', sad: '💔', romantic: '❤️', energetic: '🔥',
  chill: '🌙', devotional: '🙏', party: '🎉', focus: '🎯',
};

const YEAR = new Date().getFullYear();
const CHIPS_POOL = [
  { label: 'Feel good', query: 'feel good hindi songs' },
  { label: 'Romance', query: `romantic bollywood songs ${YEAR}` },
  { label: 'Relax', query: 'relaxing lofi hindi songs' },
  { label: 'Party', query: `party hits bollywood ${YEAR}` },
  { label: 'Sleep', query: 'sleep calm music hindi' },
  { label: 'Energize', query: 'energetic workout hindi songs' },
  { label: 'Sad Songs', query: 'sad emotional hindi songs arijit' },
  { label: 'Trending', query: `trending bollywood ${YEAR}` },
  { label: 'Arijit Singh', query: 'arijit singh best songs' },
  { label: 'AP Dhillon', query: 'ap dhillon songs' },
  { label: 'Lofi', query: 'lofi hindi chill beats' },
  { label: 'Retro', query: '90s bollywood hits' },
  { label: 'Latest Hits', query: 'latest bollywood songs' },
  { label: 'Hip Hop', query: 'hindi hip hop rap' },
  { label: 'Devotional', query: 'bhakti songs hindi' },
  { label: 'Soulful', query: 'soulful hindi melodies' },
  { label: 'Indie', query: 'indian indie pop' },
  { label: 'Classical', query: 'indian classical fusion' },
  { label: 'Gym', query: 'hindi gym motivation powerhouse' },
  { label: 'Drive', query: 'long drive bollywood songs' },
];


const NAV_ITEMS = [
  { id: 'home', icon: '🏠', label: 'Home' },
  { id: 'library', icon: '📁', label: 'Library' },
  { id: 'player', icon: '🎵', label: 'Player' },
  { id: 'replay', icon: '📊', label: 'Replay' },
  { id: 'about', icon: '👨‍💻', label: 'Creator' }
];


// ─────────────────────────────────────────────────────────────────────────────
function MainApp({ user, logout }) {
  // Playback
  const [songs, setSongs] = useState([]);
  const [queue, setQueue] = useState([]); // Actual playback queue
  const [searchSource, setSearchSource] = useState('saavn');
  const [currentSong, setCurrentSong] = useState(null);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [prevVolume, setPrevVolume] = useState(1);
  const audioRef = useRef(null);

  // Player extras
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState('off'); // 'off' | 'all' | 'one'
  const [liked, setLiked] = useState({});      // { songId: true/false }
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const moreMenuRef = useRef(null);

  // Right panel (UP NEXT / LYRICS / RELATED)
  const [showRightPanel, setShowRightPanel] = useState(false);
  const [rightPanelTab, setRightPanelTab] = useState('upnext');
  const [lyrics, setLyrics] = useState([]);        // [{time, text, romanized}]
  const [activeLyricIdx, setActiveLyricIdx] = useState(0);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [lyricsAvailable, setLyricsAvailable] = useState(false);
  const lyricsScrollRef = useRef(null);
  const activeLyricRef = useRef(null);

  // Search
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);

  // AI
  const [aiInput, setAiInput] = useState('');
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'dark');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);
  const [aiMessage, setAiMessage] = useState('');
  const [aiReasoning, setAiReasoning] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [currentMood, setCurrentMood] = useState('');
  const [listLabel, setListLabel] = useState('');

  // UI State
  const [activeNav, setActiveNav] = useState('home');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showAIPanel, setShowAIPanel] = useState(false);
  const [selectedChip, setSelectedChip] = useState(null);
  const [chips, setChips] = useState([]);
  const [showBottomNav, setShowBottomNav] = useState(true);
  const [activePlaylistMenuSongId, setActivePlaylistMenuSongId] = useState(null);
  const lastScrollY = useRef(0);

  // Playlists
  const [playlists, setPlaylists] = useState(() => {
    try { return JSON.parse(localStorage.getItem('dj_debarpan_playlists')) || []; }
    catch { return []; }
  });

  useEffect(() => {
    localStorage.setItem('dj_debarpan_playlists', JSON.stringify(playlists));
  }, [playlists]);

  const createPlaylist = () => {
    const name = prompt("Enter playlist name:");
    if (name) {
      setPlaylists([...playlists, { id: Date.now(), name, songs: [] }]);
    }
  };

  const deletePlaylist = (id, e) => {
    e.stopPropagation();
    if (window.confirm("Delete this playlist?")) {
      setPlaylists(prev => prev.filter(p => p.id !== id));
      if (activeNav === `playlist-${id}`) setActiveNav('home');
    }
  };

  const addToPlaylist = (playlistId, song) => {
    setPlaylists(prev => prev.map(p => {
      if (p.id === playlistId) {
        // Prevent duplicates
        if (p.songs.some(s => s.id === song.id)) {
          alert('Song already in playlist!');
          return p;
        }
        return { ...p, songs: [...p.songs, song] };
      }
      return p;
    }));
    setShowMoreMenu(false);
  };

  const openPlaylist = (p) => {
    setActiveNav(`playlist-${p.id}`);
    setSongs(p.songs);
    setListLabel(`Playlist: ${p.name}`);
    setSidebarOpen(false);
  };

  const [showPlaylistSubmenu, setShowPlaylistSubmenu] = useState(false);
  useEffect(() => {
    if (!showMoreMenu) setShowPlaylistSubmenu(false);
  }, [showMoreMenu]);

  // Scroll logic for bottom nav
  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      if (currentScrollY > lastScrollY.current && currentScrollY > 100) {
        setShowBottomNav(false);
      } else {
        setShowBottomNav(true);
      }
      lastScrollY.current = currentScrollY;
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Splash Screen State
  const [showSplash, setShowSplash] = useState(true);

  const handleSplashEnd = () => {
    setShowSplash(false);
  };

  // ── Mobile Audio Unlocker (Bypasses strict autoplay policies) ──
  useEffect(() => {
    const unlock = () => {
      if (audioRef.current) {
        const p = audioRef.current.play();
        if (p && p.then) {
          p.then(() => { audioRef.current.pause(); }).catch(() => {});
        }
        document.removeEventListener('click', unlock);
        document.removeEventListener('touchstart', unlock);
        console.log('Mobile Audio Context Unlocked');
      }
    };
    document.addEventListener('click', unlock);
    document.addEventListener('touchstart', unlock);
    return () => {
      document.removeEventListener('click', unlock);
      document.removeEventListener('touchstart', unlock);
    };
  }, []);

  useEffect(() => {
    if (showSplash) {
      // Failsafe: hide splash after 6s even if video fails to end
      const timer = setTimeout(() => setShowSplash(false), 6000);
      return () => clearTimeout(timer);
    }
  }, [showSplash]);


  // History & session
  const [history, setHistory] = useState(loadHistory);
  const [sessionSongs, setSessionSongs] = useState([]);
  const [nextQueue, setNextQueue] = useState([]);
  const [downloadedSongs, setDownloadedSongs] = useState(() => {
    try { return JSON.parse(localStorage.getItem('ytm_downloads') || '[]'); } catch { return []; }
  });
  const [downloadingIds, setDownloadingIds] = useState(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [autoNext, setAutoNext] = useState(true);
  const [playStartTime, setPlayStartTime] = useState(null);
  const playStartRef = useRef(null);

  // Refs
  const handleAIRef = useRef(null);
  const currentSongRef = useRef(null);
  currentSongRef.current = currentSong;

  // ── Lyrics utilities ────────────────────────────────────────────────────
  // Parse LRC-format lyrics ([mm:ss.xx] text)
  const parseLRC = (lrcText) => {
    const re = /\[(\d{2}):(\d{2})[.:]?(\d{2,3})?\]/g;
    const lines = lrcText.split('\n');
    const parsed = [];
    for (const line of lines) {
      const matches = [...line.matchAll(re)];
      if (!matches.length) continue;
      const text = line.replace(re, '').trim();
      if (!text) continue;
      for (const m of matches) {
        const time = +m[1] * 60 + +m[2] + (m[3] ? +m[3] / (m[3].length === 3 ? 1000 : 100) : 0);
        parsed.push({ time, text, romanized: '' });
      }
    }
    return parsed.sort((a, b) => a.time - b.time);
  };

  // Distribute plain-text lines across song duration
  const distributeLines = (rawText, dur = 200) => {
    const text = rawText
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/  +/g, '\n');
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) return [];
    const gap = dur / lines.length;
    return lines.map((text, i) => ({ time: i * gap + gap * 0.15, text, romanized: '' }));
  };

  const hasDevanagari = (text) => /[\u0900-\u097F]/.test(text);

  // Close menus on outside click
  useEffect(() => {
    const handler = (e) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target)) setShowMoreMenu(false);
      if (!e.target.closest('.song-action-wrap')) setActivePlaylistMenuSongId(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Persist history ──────────────────────────────────────────────────
  useEffect(() => { saveHistory(history); }, [history]);

  // ── Notification permission (Native) ──────────────────────────────────
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      if ('Notification' in window && Notification.permission === 'default') {
        setTimeout(() => Notification.requestPermission(), 2000);
      }
      return;
    }
    (async () => {
      try {
        const { LocalNotifications } = await import('@capacitor/local-notifications');
        const status = await LocalNotifications.checkPermissions();
        if (status.display !== 'granted') await LocalNotifications.requestPermissions();
      } catch (e) {
        console.warn('Notification permission request failed:', e);
      }
    })();
  }, []);

  // ── Track listening time for Monthly Replay ────────────────────────
  const monthTrackRef = useRef({ song: null, start: null });

  useEffect(() => {
    const act = monthTrackRef.current;

    // Evaluate if we need to commit the previously tracked session
    if (act.song && act.start) {
      if (!isPlaying || act.song.id !== currentSong?.id) {
        const listenedMs = Date.now() - act.start;
        // Fetch genre from global history if it exists, otherwise default
        const histSong = history?.songs?.[act.song.id] || {};
        const mergedSong = { ...act.song, genre: histSong.genre || 'Pop' };

        if (listenedMs > 5000) recordMonthlyPlay(mergedSong, listenedMs);
        act.start = null;
      }
    }

    // Assign new tracked session if playing
    if (isPlaying && currentSong) {
      if (act.song?.id !== currentSong.id || !act.start) {
        act.song = currentSong;
        act.start = Date.now();
      }
    }
  }, [isPlaying, currentSong, history]);

  // ── Personalized startup ─────────────────────────────────────────────
  const loadHomeFeed = useCallback(() => {
    setLoading(true);
    setQuery('');
    setSelectedChip(null);

    const isOnline = navigator.onLine;
    if (!isOnline && downloadedSongs.length > 0) {
      setListLabel('Offline Mode · Saved Songs');
      setSongs(downloadedSongs);
      setLoading(false);
      return;
    }

    const topArtists = getTopArtists(history);
    const topMoods = getTopMoods(history);
    const timeCtx = getTimeContext();

    if (topArtists.length > 0 || user?.artists?.length > 0) {
      setListLabel(`For You — ${timeGreeting()}, ${user.name}`);
      axios.post('/api/for-you', {
        topArtists, topMoods, timeContext: timeCtx,
        explicitGenres: user.genres, explicitArtists: user.artists
      })
        .then((r) => { setSongs(r.data?.songs || []); setLoading(false); })
        .catch(() => {
          if (downloadedSongs.length > 0) {
            setListLabel('Offline · Playing Downloads');
            setSongs(downloadedSongs);
          } else {
            axios.get('/api/charts').then((r) => setSongs(r.data?.data?.results || [])).catch(() => {});
          }
          setLoading(false);
        });
    } else {
      setListLabel(`${timeGreeting()}, ${user.name} 👋`);
      axios.get('/api/charts')
        .then((r) => { setSongs(r.data?.data?.results || []); setLoading(false); })
        .catch(() => {
          if (downloadedSongs.length > 0) {
            setListLabel('Offline · Saved Songs');
            setSongs(downloadedSongs);
          }
          setLoading(false);
        });
    }
  }, [history, user, downloadedSongs]);

  useEffect(() => {
    // Generate dynamic chips
    const base = [...CHIPS_POOL].sort(() => 0.5 - Math.random());
    const personalized = [];

    // Mix in user's top artists if any
    const topA = getTopArtists(history, 3);
    topA.forEach(a => {
      personalized.push({ label: a.name, query: `${a.name} best songs` });
    });

    // Mix in explicit choices
    if (user.artists) {
      user.artists.slice(0, 2).forEach(a => {
        if (!personalized.find(p => p.label === a))
          personalized.push({ label: a, query: `${a} songs` });
      });
    }

    const final = [...personalized, ...base].slice(0, 12);
    setChips(final);

    loadHomeFeed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Fetch lyrics when song changes ──────────────────────────────────────
  useEffect(() => {
    if (!currentSong?.id) return;
    setLyrics([]);
    setActiveLyricIdx(0);
    setLyricsAvailable(false);
    setLyricsLoading(true);

    const trackName = encodeURIComponent(currentSong.name || '');
    const artistName = encodeURIComponent(currentSong.artists?.primary?.[0]?.name || '');

    axios.get(`/api/lyrics/${currentSong.id}?t=${trackName}&a=${artistName}`)
      .then(async (res) => {
        const raw = res.data?.data?.lyrics || '';
        if (!raw) { setLyricsLoading(false); return; }

        // Detect LRC format or plain text
        const isLRC = /\[\d{2}:\d{2}/.test(raw);
        let parsed = isLRC ? parseLRC(raw) : distributeLines(raw, duration || 240);
        if (!parsed.length) { setLyricsLoading(false); return; }

        setLyrics(parsed);
        setLyricsAvailable(true);
        setLyricsLoading(false);

        // Romanize Hindi lines via AI in background
        const hindiLines = parsed
          .filter(l => hasDevanagari(l.text))
          .map(l => l.text);

        if (hindiLines.length > 0) {
          try {
            const rm = await axios.post('/api/transliterate', { lines: hindiLines });
            const romanized = rm.data?.romanized || [];
            let ri = 0;
            setLyrics(prev => prev.map(l =>
              hasDevanagari(l.text) ? { ...l, romanized: romanized[ri++] || '' } : l
            ));
          } catch { /* transliteration non-critical */ }
        }
      })
      .catch(() => setLyricsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSong?.id]);

  // ── Sync active lyric line with playback position ───────────────────────
  useEffect(() => {
    if (!lyrics.length) return;
    const t = (progress / 100) * duration;
    let idx = 0;
    for (let i = 0; i < lyrics.length; i++) {
      if (lyrics[i].time <= t) idx = i;
      else break;
    }
    if (idx !== activeLyricIdx) setActiveLyricIdx(idx);
  }, [progress, lyrics, duration]);

  // ── Auto-scroll active lyric into view ─────────────────────────────────
  useEffect(() => {
    activeLyricRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeLyricIdx]);


  // ── Pre-fetch next queue ─────────────────────────────────────────────

  const prefetchNext = useCallback(async (song, session) => {
    if (!song) return;
    const artistName = song.artists?.primary?.map((a) => a.name).join(', ') || '';
    try {
      const res = await axios.post('/api/next-song', {
        currentSong: song, topArtists: getTopArtists(history, 2),
        sessionSongs: session,
        timeContext: getTimeContext(),
        songHistory: history.songs,
        explicitGenres: user.genres, explicitArtists: user.artists
      });
      setNextQueue(res.data?.songs || []);
    } catch { }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, user]);

  // ── Auto-fix "Unknown" Artists via AI ────────────────────────────────
  const fixUnknownArtistWithAI = async (song) => {
    const currentResolved = resolveArtist(song);
    if (!currentResolved || currentResolved === 'Unknown') {
      try {
        const res = await axios.post('/api/resolve-artist', { songName: song.name });
        const aiArtist = res.data?.artist;
        if (aiArtist && aiArtist.length < 50 && !aiArtist.includes('Unknown')) {
          // Mutate the song object so that Monthly Replay catches it when the song finishes
          song.primaryArtists = aiArtist;

          // Force update local history if it was already recorded
          setHistory(prev => {
            const nextHistory = { ...prev };
            if (nextHistory.songs[song.id]) {
              nextHistory.songs[song.id].artistName = aiArtist;
            }
            return nextHistory;
          });
        }
      } catch (err) {
        console.error('AI artist resolution failed', err);
      }
    }
  };

  // ── Play a song ──────────────────────────────────────────────────────
  // ── Play a song ──
  const toggleSelection = (id) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleDeleteDownloads = async () => {
    if (!selectedIds.size) return;
    if (!window.confirm(`Permanently delete ${selectedIds.size} songs from your device?`)) return;

    const remaining = downloadedSongs.filter(s => !selectedIds.has(s.id));
    setDownloadedSongs(remaining);
    localStorage.setItem('ytm_downloads', JSON.stringify(remaining));

    try {
      const db = await getDB();
      const tx = db.transaction('songs', 'readwrite');
      const store = tx.objectStore('songs');
      for (const id of selectedIds) {
        store.delete(id);
      }
      await new Promise((res, rej) => {
        tx.oncomplete = res;
        tx.onerror = () => rej(tx.error);
      });
    } catch(err) { console.error("IDB deletion failed", err); }

    setSelectedIds(new Set());
    setSelectionMode(false);
  };

  const playSong = useCallback(async (song, mood = currentMood, idx = -1, fromQueue = false) => {
    let playTarget = song;
    
    // Check if song is downloaded
    let existingUrl = song.downloadUrl?.[4]?.link || song.downloadUrl?.[2]?.link || song.downloadUrl?.[0]?.link;
    const isDownloaded = downloadedSongs.some(s => s.id === song.id);

    if (isDownloaded) {
      try {
        const blob = await getOffline(song.id);
        if (blob) {
          existingUrl = URL.createObjectURL(blob);
          console.log("Playing from offline storage ✨");
        }
      } catch (e) { console.error("Offline read failed", e); }
    }

    // 1. CRITICAL FOR MOBILE: Prime the audio element synchronously within the click handler
    if (audioRef.current) {
        setIsBuffering(true);
        if (existingUrl) {
            audioRef.current.src = existingUrl;
            audioRef.current.load();
            audioRef.current.play()
                .then(() => setIsBuffering(false))
                .catch(() => {
                    setIsBuffering(false);
                    setIsPlaying(false);
                });
            setIsPlaying(true);
        }
    }

    // 2. ASYNC: Cross-match for YouTube/Apple if URL is missing
    if (!existingUrl && (song.source === 'youtube' || song.source === 'apple')) {
      try {
        const searchQuery = `${song.name} ${song.artists?.primary?.[0]?.name || ''}`.trim();
        const res = await axios.get(`/api/search?query=${encodeURIComponent(searchQuery)}&limit=1`);
        const match = res.data?.data?.results?.[0];
        
        if (match && match.downloadUrl) {
            song.downloadUrl = match.downloadUrl;
            song.saavnCrossId = match.id;
            playTarget = song;
            const newUrl = match.downloadUrl?.[4]?.link || match.downloadUrl?.[2]?.link || match.downloadUrl?.[0]?.link;
            if (audioRef.current && newUrl) {
                audioRef.current.src = newUrl;
                audioRef.current.load();
                audioRef.current.play().catch(() => {});
                setIsPlaying(true);
            }
        } else {
            throw new Error("Cross-match failed");
        }
      } catch (e) {
        setIsBuffering(false);
        return;
      }
    }

    const finalUrl = playTarget.downloadUrl?.[4]?.link || playTarget.downloadUrl?.[2]?.link || playTarget.downloadUrl?.[0]?.link;
    if (!finalUrl) { setIsBuffering(false); return; }

    // 3. Metadata and History updates
    if (playStartTime && currentSongRef.current) {
      const listenedMs = Date.now() - playStartTime;
      if (listenedMs < 20000) {
        setHistory((h) => recordSkip({ ...h }, currentSongRef.current.id));
      }
    }

    setCurrentSong(playTarget);
    if (idx >= 0) {
      setCurrentIndex(idx);
      if (!fromQueue) setQueue([...songs]); // Only pin the queue if playing from a new list view
    } else if (!fromQueue) {
       // Single song play (e.g. from AI or deep link)
       setQueue([song]);
       setCurrentIndex(0);
    }
    setPlayStartTime(Date.now());
    setProgress(0);
    setDuration(0);
    
    setSessionSongs((prev) => {
      const updated = [{ id: song.id }, ...prev].slice(0, 50);
      setHistory((h) => recordPlay({ ...h }, playTarget, mood));
      prefetchNext(playTarget, updated);
      fixUnknownArtistWithAI(playTarget);
      return updated;
    });

    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [currentMood, playStartTime, prefetchNext, volume, songs]);

  // ── Navigate by index (prev / next) ────────────────────────────────
  const playByIndex = useCallback((idx) => {
    if (queue.length === 0) return;
    const clamped = ((idx % queue.length) + queue.length) % queue.length;
    playSong(queue[clamped], currentMood, clamped, true);
  }, [queue, playSong, currentMood]);

  const playPrev = useCallback(() => {
    // If >3s in, restart; else go to previous
    if (audioRef.current && audioRef.current.currentTime > 3) {
      audioRef.current.currentTime = 0;
      setProgress(0);
      return;
    }
    if (shuffle) { playByIndex(Math.floor(Math.random() * queue.length)); return; }
    if (currentIndex > 0) playByIndex(currentIndex - 1);
  }, [currentIndex, shuffle, playByIndex, queue.length]);

  const playNext = useCallback(() => {
    if (shuffle) { playByIndex(Math.floor(Math.random() * queue.length)); return; }
    if (currentIndex >= 0 && currentIndex < queue.length - 1) {
      playByIndex(currentIndex + 1);
    } else if (nextQueue.length > 0) {
      const sessionIds = new Set(sessionSongs.map((s) => s.id));
      const next = nextQueue.find((s) => !sessionIds.has(s.id));
      if (next) playSong(next, currentMood);
    }
  }, [currentIndex, shuffle, queue.length, nextQueue, sessionSongs, playSong, currentMood, playByIndex]);

  // ── Auto-next on song end ────────────────────────────────────────────
  const handleSongEnd = useCallback(() => {
    if (repeat === 'one') {
      audioRef.current.currentTime = 0;
      audioRef.current.play();
      return;
    }
    setIsPlaying(false);
    if (!autoNext) return;
    if (repeat === 'all' && currentIndex === queue.length - 1) { playByIndex(0); return; }
    playNext();
  }, [repeat, autoNext, playNext, playByIndex, currentIndex, queue.length]);

  // ── AI Recommend ─────────────────────────────────────────────────────
  const handleAIRequest = useCallback(async (text) => {
    const input = (text || aiInput).trim();
    if (!input) return;
    setAiLoading(true);
    setAiMessage('');
    setAiReasoning('');
    setShowAIPanel(true);

    const recentSongs = getRecentSongs(history);
    const topArtists = getTopArtists(history);
    const topMoods = getTopMoods(history);
    const timeCtx = getTimeContext();

    try {
      const res = await axios.post('/api/ai-smart', {
        prompt: input, recentSongs, topArtists, topMoods, sessionSongs,
        timeContext: timeCtx, songHistory: history.songs,
        explicitGenres: user.genres, explicitArtists: user.artists, userName: user.name
      });
      const { songs: aiSongs, aiMessage: msg, reasoning, primaryMood, autoPlay } = res.data;

      setAiMessage(msg);
      setAiReasoning(reasoning || '');
      setCurrentMood(primaryMood || '');
      setListLabel(msg || 'AI Picks ✨');
      setSongs(aiSongs);
      if (autoPlay && aiSongs.length > 0) {
        setTimeout(() => playSong(aiSongs[0], primaryMood), 400);
      }
    } catch {
      setAiMessage('Something went wrong. Try again. 😅');
    }
    setAiLoading(false);
  }, [aiInput, history, sessionSongs, playSong]);

  handleAIRef.current = handleAIRequest;

  // ── Search ───────────────────────────────────────────────────────────
  // Live search effect (Search as you type)
  useEffect(() => {
    if (!query.trim()) {
      // If query is cleared, maybe we want to keep current songs or clear them. 
      // For now, we do nothing to let the home feed or current list remain.
      return;
    }
    const timer = setTimeout(async () => {
      setLoading(true);
      setListLabel(`Results for "${query}"`);
      setSelectedChip(null);
      let endpoint = '/api/search';
      if (searchSource === 'youtube') endpoint = '/api/yt/search';
      if (searchSource === 'apple') endpoint = '/api/apple/search';
      try {
        const res = await axios.get(`${endpoint}?query=${encodeURIComponent(query)}`);
        setSongs(res.data?.data?.results || []);
      } catch (e) {
        console.error("Live search failed", e);
      }
      setLoading(false);
    }, 350); // 350ms debounce for snappy feel
    return () => clearTimeout(timer);
  }, [query]);

  const searchSongs = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setListLabel(`Results for "${query}"`);
    setSelectedChip(null);
    let endpoint = '/api/search';
    if (searchSource === 'youtube') endpoint = '/api/yt/search';
    if (searchSource === 'apple') endpoint = '/api/apple/search';
    const res = await axios.get(`${endpoint}?query=${encodeURIComponent(query)}`);
    setSongs(res.data?.data?.results || []);
    setLoading(false);
  };

  // ── Genre chip click ─────────────────────────────────────────────────
  const handleChipClick = async (chip) => {
    setSelectedChip(chip.label);
    setLoading(true);
    setListLabel(chip.label);
    const endpoint = searchSource === 'youtube' ? '/api/yt/search' : (searchSource === 'apple' ? '/api/apple/search' : '/api/search');
    try {
      const res = await axios.get(`${endpoint}?query=${encodeURIComponent(chip.query)}`);
      const results = res.data?.data?.results || [];
      setSongs(results);
      if (results.length > 0) {
        setTimeout(() => playSong(results[0], chip.label, 0), 300);
      }
    } catch { }
    setLoading(false);
  };

  // ── Playback helpers ─────────────────────────────────────────────────
  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) { audioRef.current.pause(); } else { audioRef.current.play(); }
    setIsPlaying(!isPlaying);
  };

  const handleTimeUpdate = () => {
    const { currentTime, duration: d } = audioRef.current;
    setProgress((currentTime / d) * 100 || 0);
    setDuration(d || 0);

    // Update OS Media Session position state
    if ('mediaSession' in navigator && d > 0 && !isNaN(d)) {
      try {
        navigator.mediaSession.setPositionState({
          duration: d,
          playbackRate: audioRef.current.playbackRate || 1,
          position: currentTime,
        });
      } catch (err) {
        console.warn('MediaSession setPositionState failed:', err);
      }
    }
  };

  const handleSeek = (e) => {
    const t = (e.target.value / 100) * audioRef.current.duration;
    audioRef.current.currentTime = t;
    setProgress(e.target.value);
  };

  const handleVolumeChange = (e) => {
    const v = parseFloat(e.target.value);
    setVolume(v);
    setPrevVolume(v > 0 ? v : prevVolume);
    if (audioRef.current) audioRef.current.volume = v;
  };

  const toggleMute = () => {
    if (volume > 0) {
      setPrevVolume(volume);
      setVolume(0);
      if (audioRef.current) audioRef.current.volume = 0;
    } else {
      setVolume(prevVolume);
      if (audioRef.current) audioRef.current.volume = prevVolume;
    }
  };

  const cycleRepeat = () => {
    setRepeat((r) => r === 'off' ? 'all' : r === 'all' ? 'one' : 'off');
  };

  // ── Media Session API (OS Integration for Lock Screen / Notifications) ──
  useEffect(() => {
    if (!('mediaSession' in navigator) || !currentSong) return;

    const artist = currentSong.artists?.primary?.map(a => a.name).join(', ') || resolveArtist(currentSong);
    const albumName = currentSong.album?.name || 'Dil Se Suno Premium';
    
    // Comprehensive artwork sizes for OS recognition (Samsung/Android/iOS)
    // We prioritize the 500x500 image for a high-quality lock-screen experience
    // Optimized artwork sizes for Samsung One UI & Android 13+
    const artwork = [
      { src: currentSong.image?.[2]?.link || currentSong.image?.[1]?.link || '', sizes: '512x512', type: 'image/jpeg' },
      { src: currentSong.image?.[1]?.link || '', sizes: '192x192', type: 'image/jpeg' }
    ].filter(a => a.src);
    
    if (artwork.length === 0) {
      artwork.push({ src: `${window.location.origin}/logo.jpg`, sizes: '512x512', type: 'image/jpeg' });
    }

    navigator.mediaSession.metadata = new window.MediaMetadata({
      title: decodeText(currentSong.name),
      artist: resolveArtist(currentSong) || 'Dil Se Suno',
      album: decodeText(currentSong.album?.name || 'Dil Se Suno'),
      artwork: artwork
    });

    // Update playback state for OS
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';

    // Update position state for seek bar on lock screen
    const d = audioRef.current?.duration || duration;
    const p = audioRef.current?.currentTime || (progress / 100 * d);
    
    if ('setPositionState' in navigator.mediaSession && d > 0 && !isNaN(d)) {
      try {
        navigator.mediaSession.setPositionState({
          duration: d,
          playbackRate: audioRef.current?.playbackRate || 1,
          position: p
        });
      } catch (e) {
        console.warn('SetPositionState failed:', e);
      }
    }

    // Register handlers
    const handlers = [
      ['play', togglePlay],
      ['pause', togglePlay],
      ['previoustrack', playPrev],
      ['nexttrack', playNext],
      ['seekbackward', (details) => {
        const skipTime = details.seekOffset || 10;
        if (audioRef.current) audioRef.current.currentTime = Math.max(audioRef.current.currentTime - skipTime, 0);
      }],
      ['seekforward', (details) => {
        const skipTime = details.seekOffset || 10;
        if (audioRef.current) audioRef.current.currentTime = Math.min(audioRef.current.currentTime + skipTime, audioRef.current.duration);
      }],
      ['seekto', (details) => {
        if (audioRef.current) {
          if (details.fastSeek && 'fastSeek' in audioRef.current) {
            audioRef.current.fastSeek(details.seekTime);
          } else {
            audioRef.current.currentTime = details.seekTime;
          }
        }
      }]
    ];

    handlers.forEach(([action, handler]) => {
      try { navigator.mediaSession.setActionHandler(action, handler); } catch (e) {}
    });

    return () => {
      handlers.forEach(([action]) => {
        try { navigator.mediaSession.setActionHandler(action, null); } catch (e) {}
      });
    };
  }, [currentSong, togglePlay, playPrev, playNext]);

  // Sync playback state and position with mediaSession (Critical for Samsung One UI / Android 13+)
  useEffect(() => {
    if (!('mediaSession' in navigator) || !currentSong) return;

    // Update playback state
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';

    // Update position state for live progress on lock screen
    if ('setPositionState' in navigator.mediaSession && duration > 0 && !isNaN(duration)) {
      try {
        navigator.mediaSession.setPositionState({
          duration: duration,
          playbackRate: audioRef.current?.playbackRate || 1,
          position: audioRef.current?.currentTime || 0
        });
      } catch (e) {
        // Fallback for older or non-standard implementations
      }
    }
  }, [isPlaying, currentSong, duration, progress]);

  // ── Native Android MediaSession (Samsung Now Bar) ─────────────────────
  // Calls NativeMediaPlugin → MusicService → MediaSessionCompat + AudioFocus
  // AudioFocus is what Samsung One UI 8 reads to decide which app owns media.
  
  // Register the custom Java plugin
  const NativeMedia = registerPlugin('NativeMedia');

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !currentSong) return;

    try {
      if (!NativeMedia) return;

      const artist = currentSong.artists?.primary?.map(a => a.name).join(', ') || '';

      NativeMedia.updateSession({
        title:     currentSong.name         || 'Unknown Title',
        artist:    artist,
        album:     currentSong.album?.name  || 'Dil Se Suno',
        isPlaying: isPlaying,
        duration:  audioRef.current?.duration    || 0,
        position:  audioRef.current?.currentTime || 0,
      }).catch(e => console.warn('NativeMedia:', e));
    } catch (e) {
      console.warn('NativeMedia sync error:', e);
    }
  }, [currentSong, isPlaying]);

  const toggleLike = (songId, val) => {
    setLiked((prev) => ({ ...prev, [songId]: prev[songId] === val ? null : val }));
  };

  const formatTime = (secs) => {
    if (!secs || isNaN(secs)) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  // ── Download Song ────────────────────────────────────────────────────
  const handleDownload = async (song) => {
    if (downloadingIds.has(song.id)) return;
    if (downloadedSongs.some(s => s.id === song.id)) return alert("Already downloaded!");

    setDownloadingIds(prev => new Set(prev).add(song.id));
    const url = song.downloadUrl?.[4]?.link || song.downloadUrl?.[2]?.link || song.downloadUrl?.[0]?.link;
    
    try {
      if (!url) throw new Error("No download URL found");
      const response = await axios.get(url, { responseType: 'blob' });
      await saveOffline(song.id, response.data);

       const updatedDownloads = [...downloadedSongs, { ...song, isOffline: true }];
      setDownloadedSongs(updatedDownloads);
      localStorage.setItem('ytm_downloads', JSON.stringify(updatedDownloads));

      // Native Notification
      if (Capacitor.isNativePlatform()) {
        try {
          await LocalNotifications.schedule({
            notifications: [
              {
                title: "Download Complete 📥",
                body: `${song.name} has been saved for offline listening.`,
                id: Math.floor(Math.random() * 100000),
                schedule: { at: new Date(Date.now() + 1000) },
              }
            ]
          });
        } catch (e) { console.error("Notification failed", e); }
      }
    } catch (err) {
      console.error(err);
      alert("Download failed. Direct download link might be restricted by server.");
    } finally {
      setDownloadingIds(prev => {
        const next = new Set(prev);
        next.delete(song.id);
        return next;
      });
    }
  };

  // ── Local Music Scanner ────────────────────────────────────────────────
  const scanLocalMusic = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*';
    input.multiple = true;
    input.onchange = async (e) => {
      const files = Array.from(e.target.files);
      if (!files.length) return;
      
      const newItems = [];
      for (const file of files) {
        const id = `local_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        const songObj = {
          id,
          name: file.name.replace(/\.[^/.]+$/, ""),
          artists: { primary: [{ name: 'Local File' }] },
          image: [{ link: null }],
          duration: 0,
          downloadUrl: [],
          isOffline: true,
          isLocal: true
        };
        await saveOffline(id, file);
        newItems.push(songObj);
      }
      const updated = [...downloadedSongs, ...newItems];
      setDownloadedSongs(updated);
      localStorage.setItem('ytm_downloads', JSON.stringify(updated));
      alert(`Imported ${files.length} songs to Downloads!`);
    };
    input.click();
  };

  const deleteOfflineSong = async (id) => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('songs', 'readwrite');
      const store = transaction.objectStore('songs');
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  };


  // ── Stats ────────────────────────────────────────────────────────────
  const topArtists = getTopArtists(history, 3);
  const topMoods = getTopMoods(history, 3);
  const hasHistory = topArtists.length > 0;
  const songCount = Object.keys(history.songs).length;

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <div className="app-shell">
      {/* ── Mobile Opening Video Splash ── */}
      {showSplash && (
        <div className="splash-screen">
          <video
            src="/splash.mp4"
            autoPlay
            playsInline
            muted
            preload="auto"
            className="splash-video"
            onEnded={handleSplashEnd}
            onError={handleSplashEnd}
          />
          <button className="splash-skip" onClick={handleSplashEnd}>Skip</button>
        </div>
      )}

      {/* ── Sidebar ── */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-logo" style={{ display: 'flex', justifyContent: 'center', padding: '16px 0', overflow: 'visible' }}>
          <img className="app-logo" src="/logo.jpg" alt="Dil Se Suno" style={{ width: '180px', height: 'auto', marginBottom: '8px', cursor: 'pointer', transition: 'transform 0.2s' }} onClick={() => loadHomeFeed()} />
        </div>

        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${activeNav === item.id ? 'active' : ''}`}
              onClick={() => {
                setActiveNav(item.id);
                if (item.id === 'home') loadHomeFeed();
              }}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </button>
          ))}
        </nav>

        {hasHistory && (
          <div className="sidebar-profile">
            <div className="profile-title">Your Taste</div>
            <div className="profile-artists">
              {topArtists.slice(0, 3).map((a) => (
                <button key={a.name} className="profile-artist-btn"
                  onClick={() => { setAiInput(a.name); handleAIRef.current(a.name); setSidebarOpen(false); }}>
                  <span className="artist-avatar">{a.name.charAt(0)}</span>
                  <span className="artist-name">{a.name}</span>
                  <span className="artist-plays">{a.playCount}✕</span>
                </button>
              ))}
            </div>
            {topMoods.length > 0 && (
              <div className="profile-moods">
                {topMoods.map((m) => (
                  <span key={m.mood} className="profile-mood-badge"
                    onClick={() => { setAiInput(`${m.mood} songs`); handleAIRef.current(`${m.mood} songs`); }}>
                    {MOOD_EMOJI[m.mood]} {m.mood}
                  </span>
                ))}
              </div>
            )}
            <div className="profile-stats">
              <span>🧠 {songCount} songs learned</span>
            </div>
          </div>
        )}

        <div className="playlist-section">
          <button className="create-playlist-btn" onClick={createPlaylist}>
            <span>➕</span> Create Playlist
          </button>
          <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {playlists.map(p => (
              <div key={p.id} className={`nav-item ${activeNav === `playlist-${p.id}` ? 'active' : ''}`} style={{ padding: 0, position: 'relative', overflow: 'hidden' }}>
                <button 
                  style={{ justifyContent: 'flex-start', padding: '10px 12px', width: '100%', background: 'none', border: 'none', color: 'inherit', textAlign: 'left', display: 'flex', alignItems: 'center' }}
                  onClick={() => openPlaylist(p)}
                >
                  <span className="nav-icon">📁</span>
                  <span className="nav-label" style={{ fontSize: '13px' }}>{p.name}</span>
                  <span style={{ marginLeft: 'auto', fontSize: '10px', opacity: 0.5, marginRight: '24px' }}>{p.songs.length}</span>
                </button>
                <button 
                  style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text3)', padding: '4px', cursor: 'pointer' }}
                  onClick={(e) => deletePlaylist(p.id, e)}
                  title="Delete playlist"
                >✕</button>
              </div>
            ))}
          </div>
        </div>


        <div style={{ padding: '24px' }}>
          <button className="auth-btn" style={{ width: '100%', padding: '10px', fontSize: '14px', background: 'var(--surface-light)' }} onClick={logout}>Sign Out</button>
          <div style={{ color: 'var(--text3)', fontSize: '10px', textAlign: 'center', marginTop: '12px', opacity: 0.5 }}>Build: 2026.04.23.13.25</div>
        </div>
      </aside>


      {/* ── Sidebar overlay (mobile) ── */}
      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}

      {/* ── Main Content ── */}
      <main className={`main-content${showRightPanel && currentSong ? ' panel-open' : ''}`} key={activeNav}>

        {/* ── Top Bar ── */}
        <header className="topbar">
          <button className="hamburger" onClick={() => setSidebarOpen(!sidebarOpen)}>
            <span /><span /><span />
          </button>

          <div className="topbar-brand" style={{ display: 'flex', alignItems: 'center', overflow: 'hidden', minWidth: '140px', justifyContent: 'center' }}>
            <img className="app-logo" src="/logo.jpg" alt="Dil Se Suno" style={{ height: '35px', width: 'auto' }} />
          </div>

          <div className="topbar-search-container" style={{display: 'flex', flexGrow: 1, gap: '8px', maxWidth: '600px'}}>
            <select
              className="source-selector"
              value={searchSource}
              onChange={e => setSearchSource(e.target.value)}
              style={{ padding: '0 12px', borderRadius: '24px', background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', outline: 'none', cursor: 'pointer', flexShrink: 0 }}
            >
              <option value="youtube">YouTube Music</option>
              <option value="saavn">JioSaavn</option>
              <option value="apple">Apple Music</option>
            </select>
            <form onSubmit={searchSongs} className="search-bar" style={{ flexGrow: 1, maxWidth: '100%' }}>
              <span className="search-icon">🔍</span>
              <input
                type="text"
                placeholder="Search songs, albums, artists..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button type="submit">Search</button>
            </form>
          </div>

          <div className="topbar-actions">
            <button className="theme-toggle-btn" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} title="Toggle Theme" style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', marginRight: '8px' }}>
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
            <button
              className={`ai-fab ${showAIPanel ? 'active' : ''}`}
              onClick={() => setShowAIPanel(!showAIPanel)}
              title="Sangeet Saathi"
            >
              ✨
            </button>
            <div className="user-avatar">{user.name?.charAt(0).toUpperCase() || 'U'}</div>

          </div>
        </header>

        {activeNav === 'about' ? <AboutCreator /> : activeNav === 'replay' ? <MonthlyReplay /> : activeNav === 'library' ? (
          <div className="library-view">
            <h1 className="view-title">Your Library</h1>
            <button className="primary-btn-wide" onClick={createPlaylist}>
              <span style={{fontSize: '20px'}}>＋</span> Create New Playlist
            </button>

            <h2 className="section-title" style={{ marginTop: '24px' }}>AI Magic Mixes ✨</h2>
            <div className="playlist-grid">
              {[
                { name: 'Your Supermix', icon: '✨', grad: 'linear-gradient(135deg, #FF3CAC 0%, #784BA0 50%, #2B86C5 100%)', prompt: 'Create a supermix of my top songs and new discoveries' },
                { name: 'Morning Energy', icon: '☀️', grad: 'linear-gradient(135deg, #FAD961 0%, #F76B1C 100%)', prompt: 'Energetic Bollywood and Pop for a great morning' },
                { name: 'Deep Focus', icon: '🧠', grad: 'linear-gradient(135deg, #0093E9 0%, #80D0C7 100%)', prompt: 'Lofi and Acoustic instrumental focus music' },
                { name: 'Night Vibes', icon: '🌙', grad: 'linear-gradient(135deg, #4158D0 0%, #C850C0 46%, #FFCC70 100%)', prompt: 'Chill evening vibes and slow reverb hits' }
              ].map(mix => (
                <div key={mix.name} className="playlist-card ai-mix-card" onClick={() => { setAiInput(mix.prompt); handleAIRef.current(mix.prompt); setActiveNav('home'); }}>
                  <div className="playlist-art" style={{ background: mix.grad }}>
                    <div className="art-placeholder" style={{ fontSize: '40px' }}>{mix.icon}</div>
                    <div className="ai-play-badge">▶</div>
                  </div>
                  <div className="playlist-info">
                    <h3 className="playlist-name">{mix.name}</h3>
                    <p className="playlist-meta-mini">AI Personalized · Fresh</p>
                  </div>
                </div>
              ))}
            </div>

            <h2 className="section-title" style={{ marginTop: '24px' }}>Your Collections</h2>
            <div className="playlist-grid">
              {/* Scan Device Button */}
              <div className="playlist-card" onClick={scanLocalMusic}>
                <div className="playlist-art" style={{ background: 'var(--surface-light)' }}>
                  <div className="art-placeholder" style={{ fontSize: '30px' }}>🔍</div>
                </div>
                <div className="playlist-info">
                  <h3 className="playlist-name">Scan Device</h3>
                  <p className="playlist-meta-mini">Import phone music</p>
                </div>
              </div>

              {downloadedSongs.length > 0 && (
                <div className="playlist-card" onClick={() => { setSongs(downloadedSongs); setListLabel("Downloaded Songs"); setActiveNav('home'); }}>
                  <div className="playlist-art">
                      <div className="art-placeholder" style={{ background: 'linear-gradient(135deg, #21D4FD 0%, #B721FF 100%)' }}>📁</div>
                  </div>
                  <div className="playlist-info">
                    <h3 className="playlist-name">Downloads</h3>
                    <p className="playlist-meta-mini">{downloadedSongs.length} songs • Offline</p>
                  </div>
                </div>
              )}
              {playlists.map(p => (
                <div key={p.id} className="playlist-card" onClick={() => openPlaylist(p)}>
                  <div className="playlist-art">
                    {p.songs[0]?.image?.[1]?.link ? (
                      <img src={p.songs[0].image[1].link} alt="" />
                    ) : (
                      <div className="art-placeholder">📂</div>
                    )}
                    <button className="playlist-del-btn" onClick={(e) => deletePlaylist(p.id, e)}>✕</button>
                  </div>
                  <div className="playlist-info">
                    <h3 className="playlist-name">{p.name}</h3>
                    <p className="playlist-meta">{p.songs.length} songs</p>
                  </div>
                </div>
              ))}
            </div>

            {hasHistory && (
              <div className="library-taste-section">
                <h2 className="section-title">Your Taste</h2>
                <div className="profile-artists-row">
                  {topArtists.map((a) => (
                    <button key={a.name} className="taste-card"
                      onClick={() => { setAiInput(a.name); handleAIRef.current(a.name); setActiveNav('home'); }}>
                      <div className="taste-avatar">{a.name.charAt(0)}</div>
                      <span className="taste-name">{a.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : activeNav === 'player' ? (
          <div className="ytm-player">
            <div
              className="np-bg-blur"
              style={{ backgroundImage: `url(${currentSong?.image?.[2]?.link || currentSong?.image?.[1]?.link})` }}
            />
            <div className="ytm-overlay" />

            {currentSong ? (
              <div className="ytm-content">
                {/* ── TOP NAV ── */}
                <div className="ytm-header">
                  <button className="ytm-header-btn" onClick={() => setActiveNav('home')}>
                    <svg viewBox="0 0 24 24" fill="white" width="28" height="28">
                      <path d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z" />
                    </svg>
                  </button>
                  <div className="ytm-header-tabs">
                    <span className="ytm-tab-item active">Song</span>
                  </div>
                  <div style={{ width: '44px' }} /> {/* Spacer for symmetry */}
                </div>

                {/* ── LARGE ARTWORK ── */}
                <div className="ytm-art-container">
                  <img
                    src={currentSong.image?.[2]?.link || currentSong.image?.[1]?.link}
                    className={`ytm-large-art ${isBuffering ? 'buffering-dim' : ''}`}
                    alt=""
                  />
                  {isBuffering && (
                    <div className="ytm-buffering">
                      <div className="spinner-ring spinner-large"></div>
                    </div>
                  )}
                </div>

                {/* ── SONG INFO ── */}
                <div className="ytm-info-row">
                  <div className="ytm-titles">
                    <h1 className="ytm-song-title">{decodeText(currentSong.name)}</h1>
                    <p className="ytm-artist-name">
                      {currentSong.artists?.primary?.map(a => a.name).join(', ') || resolveArtist(currentSong)}
                    </p>
                  </div>
                </div>

                {/* ── ACTION BUTTONS ── */}
                <div className="ytm-actions-row">
                  <button 
                    className={`ytm-action-pill ${downloadingIds.has(currentSong.id) ? 'pulse' : ''}`}
                    onClick={() => handleDownload(currentSong)}
                    disabled={downloadingIds.has(currentSong.id)}
                  >
                    <svg viewBox="0 0 24 24" fill="white" width="18" height="18" style={{ marginRight: '8px' }}>
                      <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
                    </svg>
                    {downloadedSongs.some(s => s.id === currentSong.id) ? 'Downloaded' : downloadingIds.has(currentSong.id) ? 'Downloading...' : 'Download'}
                  </button>
                </div>

                {/* ── PROGRESS BAR ── */}
                <div className="ytm-progress-container">
                  <div className="ytm-seek-track">
                    <div className="ytm-seek-fill" style={{ width: `${progress}%` }} />
                    <input
                      type="range"
                      className="ytm-seek-input"
                      min="0" max="100"
                      value={progress}
                      onChange={handleSeek}
                    />
                  </div>
                  <div className="ytm-time-labels">
                    <span className="ytm-time-text">{formatTime((progress / 100) * duration)}</span>
                    <span className="ytm-time-text">{formatTime(duration)}</span>
                  </div>
                </div>

                {/* ── MAIN CONTROLS ── */}
                <div className="ytm-play-controls">
                  <button
                    className={`ytm-ctrl-btn ${shuffle ? 'ytm-ctrl-active' : ''}`}
                    onClick={() => setShuffle(!shuffle)}
                  >
                    <svg viewBox="0 0 24 24" width="24" height="24" fill="white" opacity={shuffle ? 1 : 0.6}>
                      <path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z" />
                    </svg>
                  </button>
                  <button className="ytm-ctrl-btn" onClick={playPrev}>
                    <svg viewBox="0 0 24 24" width="36" height="36" fill="white">
                      <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
                    </svg>
                  </button>
                  <button className="ytm-main-play-btn" onClick={togglePlay}>
                    {isPlaying ? (
                      <svg viewBox="0 0 24 24" width="40" height="40" fill="black">
                        <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" width="40" height="40" fill="black">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    )}
                  </button>
                  <button className="ytm-ctrl-btn" onClick={playNext}>
                    <svg viewBox="0 0 24 24" width="36" height="36" fill="white">
                      <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
                    </svg>
                  </button>
                  <button
                    className={`ytm-ctrl-btn ${repeat !== 'off' ? 'ytm-ctrl-active' : ''}`}
                    onClick={cycleRepeat}
                  >
                    {repeat === 'one' ? (
                      <svg viewBox="0 0 24 24" width="24" height="24" fill="white" opacity={repeat !== 'off' ? 1 : 0.6}>
                        <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" width="24" height="24" fill="white" opacity={repeat !== 'off' ? 1 : 0.6}>
                        <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z" />
                      </svg>
                    )}
                  </button>
                </div>

                {/* ── BOTTOM TABS ── */}
                <div className="ytm-bottom-tabs">
                  <button 
                    className="ytm-bottom-tab-btn"
                    onClick={() => { setRightPanelTab('upnext'); setShowRightPanel(true); }}
                  >
                    UP NEXT
                  </button>
                  <button 
                    className="ytm-bottom-tab-btn"
                    onClick={() => { setRightPanelTab('lyrics'); setShowRightPanel(true); }}
                  >
                    LYRICS
                  </button>
                  <button 
                    className="ytm-bottom-tab-btn"
                    onClick={() => { setRightPanelTab('related'); setShowRightPanel(true); }}
                  >
                    RELATED
                  </button>
                </div>
              </div>
            ) : (
              <div className="no-playing-state">
                <div className="empty-icon">🎵</div>
                <h2>Not Playing</h2>
                <p>Pick a song from the library to start listening</p>
                <button className="primary-btn" onClick={() => setActiveNav('home')} style={{marginTop: '20px'}}>Go to Home</button>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* ── Genre Chips ── */}
            <div className="chips-row">
              {chips.map((chip) => (
                <button
                  key={chip.label}
                  className={`genre-chip ${selectedChip === chip.label ? 'active' : ''}`}
                  onClick={() => handleChipClick(chip)}
                >
                  {chip.label}
                </button>
              ))}
            </div>

            {/* ── AI Panel ── */}
            {showAIPanel && (
              <div className="ai-panel">
                <div className="ai-panel-header">
                  <span className="ai-panel-icon">✨</span>
                  <div>
                    <div className="ai-panel-title">Sangeet Saathi</div>
                    <div className="ai-panel-badge">Llama 3.1 · NVIDIA NIM · Personalized for you</div>
                  </div>
                  <button className="ai-panel-close" onClick={() => setShowAIPanel(false)}>✕</button>
                </div>

                <p className="ai-hint">
                  🎤 <em>Try: "play sad Arijit songs"</em> · <em>"I'm feeling pumped"</em> · <em>"chill night lofi"</em>
                </p>

                <div className="ai-input-row">
                  <input
                    className="ai-text-input"
                    type="text"
                    placeholder="Tell me what to play…"
                    value={aiInput}
                    onChange={(e) => setAiInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAIRequest()}
                  />
                  <button className="ai-send-btn" onClick={() => handleAIRequest()} disabled={aiLoading}>
                    {aiLoading ? <span className="spin">⏳</span> : '➤'}
                  </button>
                </div>

                {aiLoading && (
                  <div className="ai-loading">
                    <div className="ai-wave"><span /><span /><span /><span /><span /></div>
                    <span className="ai-loading-text">AI is crafting your playlist…</span>
                  </div>
                )}

                {aiMessage && !aiLoading && (
                  <div className="ai-message">
                    <div className="ai-avatar-icon">✨</div>
                    <div className="ai-msg-body">
                      {currentMood && (
                        <span className="mood-tag">{MOOD_EMOJI[currentMood]} {currentMood}</span>
                      )}
                      <p className="ai-msg-text">{aiMessage}</p>
                      {aiReasoning && <p className="ai-reasoning">{aiReasoning}</p>}
                    </div>
                  </div>
                )}

                <div className="ai-footer-row">
                  <label className="toggle-label">
                    <span className={`toggle-switch ${autoNext ? 'on' : ''}`} onClick={() => setAutoNext((p) => !p)} />
                    <span className="toggle-text">{autoNext ? '🔁 Auto-play ON' : '🔁 Auto-play OFF'}</span>
                  </label>
                  {hasHistory && (
                    <span className="history-badge">🧠 {songCount} learned</span>
                  )}
                </div>

                {/* Quick mood buttons */}
                <div className="quick-moods">
                  {Object.entries(MOOD_EMOJI).map(([mood, emoji]) => (
                    <button key={mood} className="quick-mood-btn"
                      onClick={() => { setAiInput(`${mood} songs`); handleAIRef.current(`${mood} songs`); }}>
                      {emoji} {mood}
                    </button>
                  ))}
                </div>
              </div>
            )}



            {/* ── Song List ── */}
            <section className="song-section">
              {/* ── Offline Banner ── */}
              {!navigator.onLine && (
                <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--red)', borderRadius: '12px', padding: '12px 16px', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--red)', fontSize: '13px', fontWeight: 600 }}>
                  <span>📡</span> Offline Mode Active · Playing from local storage
                </div>
              )}

              {listLabel && (
                <div className="section-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                    <h2 className="section-title">{listLabel}</h2>
                    {songs.length > 0 && (
                      <span className="section-count">{songs.length} songs</span>
                    )}
                  </div>
                  {listLabel.includes('Downloaded') && songs.length > 0 && (
                    <button 
                      className="manage-btn" 
                      onClick={() => { setSelectionMode(!selectionMode); setSelectedIds(new Set()); }}
                      style={{ padding: '6px 12px', background: selectionMode ? 'var(--red)' : 'var(--surface-light)', borderRadius: '20px', color: 'white', border: 'none', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
                    >
                      {selectionMode ? 'Cancel' : 'Manage'}
                    </button>
                  )}
                </div>
              )}

              {/* ── Personal taste shortcuts (Placed AFTER greeting) ── */}
              {hasHistory && !showAIPanel && listLabel.includes('For You') && (
                <div className="taste-bar" style={{ padding: '0 0 16px 0' }}>
                  <span className="taste-bar-label">Your vibe:</span>
                  {topArtists.slice(0, 2).map((a) => (
                    <button key={a.name} className="taste-chip"
                      onClick={() => { setAiInput(a.name); handleAIRef.current(a.name); }}>
                      🎤 {a.name}
                    </button>
                  ))}
                  {topMoods.slice(0, 1).map((m) => (
                    <button key={m.mood} className="taste-chip mood-chip"
                      onClick={() => { setAiInput(`${m.mood} songs`); handleAIRef.current(`${m.mood} songs`); }}>
                      {MOOD_EMOJI[m.mood]} {m.mood}
                    </button>
                  ))}
                </div>
              )}

              {loading && (
                <div className="loading-shimmer">
                  {[...Array(6)].map((_, i) => (
                    <div key={i} className="shimmer-card">
                      <div className="shimmer-img" />
                      <div className="shimmer-lines">
                        <div className="shimmer-line long" />
                        <div className="shimmer-line short" />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!loading && songs.length > 0 && (
                <div className="song-list">
                  {songs.map((song, idx) => {
                    const songHistory = history.songs[song.id];
                    const playCount = songHistory?.playCount || 0;
                    const artistName = resolveArtist(song) || '—';
                    const isActive = currentSong?.id === song.id;
                    const imgUrl = song.image?.[1]?.link || song.image?.[0]?.link;

                    return (
                      <div
                        key={song.id}
                        className={`song-card ${isActive ? 'active' : ''} ${selectedIds.has(song.id) ? 'selected-item' : ''}`}
                        onClick={() => selectionMode ? toggleSelection(song.id) : playSong(song, currentMood, idx)}
                      >
                        <span className="song-index" style={{ display: 'flex', alignItems: 'center' }}>
                          {selectionMode ? (
                            <div className={`custom-checkbox ${selectedIds.has(song.id) ? 'checked' : ''}`}>
                              {selectedIds.has(song.id) && '✓'}
                            </div>
                          ) : isActive && isPlaying ? (
                            <span className="eq-bars"><span /><span /><span /><span /></span>
                          ) : (
                            <span className="idx-num">{idx + 1}</span>
                          )}
                        </span>

                        <div className="song-thumb">
                          {imgUrl ? (
                            <img src={imgUrl} alt={song.name} className="song-img" />
                          ) : (
                            <div className="song-img-placeholder">🎵</div>
                          )}
                          <div className="song-thumb-overlay">
                            {isActive && isPlaying ? '⏸' : '▶'}
                          </div>
                        </div>

                        <div className="song-info">
                          <p className="song-name">{decodeText(song.name)}</p>
                          <p className="song-artist">{artistName}</p>
                        </div>

                        <div className="song-meta">
                          {playCount > 0 && (
                            <span className="play-count-badge">▶ {playCount}</span>
                          )}
                          <div className="song-action-wrap" onClick={(e) => e.stopPropagation()}>
                            <button 
                              className={`add-song-plus ${activePlaylistMenuSongId === song.id ? 'active' : ''}`}
                              onClick={() => setActivePlaylistMenuSongId(activePlaylistMenuSongId === song.id ? null : song.id)}
                              title="Add to playlist"
                            >
                              ＋
                            </button>
                            {activePlaylistMenuSongId === song.id && (
                              <div className="song-playlist-dropdown">
                                <div className="dropdown-header">Add to Playlist</div>
                                {playlists.length === 0 ? (
                                  <button className="dropdown-opt disabled" onClick={createPlaylist}>Create first playlist</button>
                                ) : (
                                  <div className="dropdown-scroll">
                                    {playlists.map(p => (
                                      <button 
                                        key={p.id} 
                                        className="dropdown-opt"
                                        onClick={() => { addToPlaylist(p.id, song); setActivePlaylistMenuSongId(null); }}
                                      >
                                        <span className="opt-icon">📁</span> {p.name}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                          {songHistory?.mood && (
                            <span className="song-mood-tag">{MOOD_EMOJI[songHistory.mood]}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {!loading && songs.length === 0 && (
                <div className="empty-state">
                  <div className="empty-icon">🎵</div>
                  <p>No songs yet. Try searching or ask the AI!</p>
                </div>
              )}
            </section>
          </>
        )}
      </main>

      {/* ── Global Audio Element (Dismount-protected) ── */}
      <audio
        ref={audioRef}
        preload="auto"
        crossOrigin="anonymous"
        onWaiting={() => setIsBuffering(true)}
        onPlaying={() => setIsBuffering(false)}
        onCanPlay={() => setIsBuffering(false)}
        onCanPlayThrough={() => setIsBuffering(false)}
        onStalled={() => setIsBuffering(true)}
        onSuspend={() => setIsBuffering(false)}
        onTimeUpdate={handleTimeUpdate}
        onEnded={handleSongEnd}
        onLoadedMetadata={(e) => setDuration(e.target.duration)}
        onError={(e) => {
          console.error('Audio Error:', e);
          setIsBuffering(false);
          setIsPlaying(false);
        }}
      />

      {/* ── Now Playing Bottom Bar ── */}
      {currentSong && (window.innerWidth > 768 || activeNav !== 'player') && (
        <div 
          className={`player ${activeNav === 'player' ? 'player-hiding' : ''}`}
          style={{ 
            backgroundImage: currentSong ? `linear-gradient(rgba(18, 18, 18, 0.7), rgba(18, 18, 18, 0.7)), url(${currentSong.image?.[1]?.link || currentSong.image?.[0]?.link})` : 'none',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backdropFilter: 'blur(40px)',
            WebkitBackdropFilter: 'blur(40px)'
          }}
        >

          {/* Thin seek bar at very top */}
          <div className="player-seekbar-track">
            <div className="player-seekbar-fill" style={{ width: `${progress}%` }} />
            <input
              type="range"
              className="player-seekbar-input"
              min="0" max="100"
              value={progress}
              onChange={handleSeek}
            />
          </div>

          <div className="player-inner">

            {/* ── LEFT: art + info + like/dislike ── */}
            <div className="player-left">
              <div
                className="player-thumb"
                onClick={() => { setActiveNav('player'); window.scrollTo(0,0); }}
                title="Open Player"
                style={{ cursor: 'pointer' }}
              >
                <img
                  src={currentSong.image?.[2]?.link || currentSong.image?.[1]?.link}
                  alt=""
                  className="player-img"
                />
                {isBuffering ? (
                  <div className="player-img-pulse buffering-pulse">
                    <div className="spinner-ring"></div>
                  </div>
                ) : (
                  isPlaying && <div className="player-img-pulse" />
                )}
              </div>
              <div className="player-info">
                <p className="player-title" title={decodeText(currentSong.name)}>{decodeText(currentSong.name)}</p>
                <p className="player-artist">
                  {currentSong.artists?.primary?.map((a) => a.name).join(', ')}
                </p>
              </div>

              {/* Like / Dislike */}
              <div className="player-reactions">
                <button
                  className={`reaction-btn ${liked[currentSong.id] === false ? 'reacted' : ''}`}
                  onClick={() => toggleLike(currentSong.id, false)}
                  title="Dislike"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                    <path d="M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z" />
                  </svg>
                </button>
                <button
                  className={`reaction-btn ${liked[currentSong.id] === true ? 'reacted liked' : ''}`}
                  onClick={() => toggleLike(currentSong.id, true)}
                  title="Like"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                    <path d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z" />
                  </svg>
                </button>
              </div>

              {/* More options */}
              <div className="more-menu-wrap" ref={moreMenuRef}>
                <button className="ctrl-btn" onClick={() => setShowMoreMenu(m => !m)} title="More options">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                    <circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" />
                  </svg>
                </button>
                {showMoreMenu && (
                  <div className="more-menu">
                    <button onClick={() => { setQuery(currentSong.artists?.primary?.[0]?.name || ''); setShowMoreMenu(false); }}>Go to artist</button>
                    <button onClick={() => { setQuery(currentSong.name); setShowMoreMenu(false); }}>Find similar</button>
                    <button onClick={() => { navigator.clipboard?.writeText(currentSong.name + ' - ' + currentSong.artists?.primary?.map(a => a.name).join(', ')); setShowMoreMenu(false); }}>Copy song info</button>
                    <button onClick={() => { setShuffle(s => !s); setShowMoreMenu(false); }}>{shuffle ? 'Disable shuffle' : 'Enable shuffle'}</button>
                    
                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', marginTop: '4px', paddingTop: '4px' }}>
                      <button 
                        style={{ color: '#a78bfa', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                        onClick={(e) => { e.stopPropagation(); setShowPlaylistSubmenu(!showPlaylistSubmenu); }}
                      >
                        Add to Playlist {showPlaylistSubmenu ? '▾' : '▸'}
                      </button>
                      {showPlaylistSubmenu && (
                        <div style={{ padding: '4px', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', marginTop: '4px' }}>
                          {playlists.length === 0 ? (
                            <p style={{ fontSize: '11px', padding: '8px', opacity: 0.5 }}>No playlists yet</p>
                          ) : playlists.map(p => (
                            <button 
                              key={p.id} 
                              style={{ fontSize: '12px', padding: '8px 12px', borderBottom: 'none' }}
                              onClick={() => addToPlaylist(p.id, currentSong)}
                            >
                              + {p.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ── CENTER: transport + progress ── */}
            <div className="player-center">
              <div className="player-controls">

                {/* Shuffle */}
                <button
                  className={`ctrl-btn ctrl-sm ${shuffle ? 'ctrl-active' : ''}`}
                  onClick={() => setShuffle(s => !s)}
                  title={shuffle ? 'Shuffle ON' : 'Shuffle OFF'}
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                    <path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z" />
                  </svg>
                </button>

                {/* Previous */}
                <button className="ctrl-btn ctrl-skip" onClick={playPrev} title="Previous">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
                    <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
                  </svg>
                </button>

                {/* Play / Pause */}
                <button className="play-btn" onClick={togglePlay} title={isPlaying ? 'Pause' : 'Play'}>
                  {isPlaying
                    ? <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
                    : <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M8 5v14l11-7z" /></svg>
                  }
                </button>

                {/* Next */}
                <button className="ctrl-btn ctrl-skip" onClick={playNext} title="Next">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
                    <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
                  </svg>
                </button>

                {/* Repeat */}
                <button
                  className={`ctrl-btn ctrl-sm ${repeat !== 'off' ? 'ctrl-active' : ''}`}
                  onClick={cycleRepeat}
                  title={repeat === 'off' ? 'Repeat off' : repeat === 'all' ? 'Repeat all' : 'Repeat one'}
                >
                  {repeat === 'one'
                    ? <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z" /></svg>
                    : <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z" /></svg>
                  }
                </button>

                {/* AutoNext (Infinity) */}
                <button
                  className={`ctrl-btn ctrl-sm ${autoNext ? 'ctrl-active' : ''}`}
                  onClick={() => setAutoNext(!autoNext)}
                  title={autoNext ? 'Autoplay related ON' : 'Autoplay related OFF'}
                  style={{ marginLeft: '6px' }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="20" height="20" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10 8a4 4 0 1 0 0 8 4 4 0 0 0 4-4M14 16a4 4 0 1 0 0-8 4 4 0 0 0-4 4" />
                  </svg>
                </button>
              </div>

              {/* Seek bar + timestamps */}
              <div className="progress-row">
                <span className="time-label">{formatTime((progress / 100) * duration)}</span>
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${progress}%` }} />
                  <input
                    type="range"
                    className="progress-input"
                    min="0" max="100"
                    value={progress}
                    onChange={handleSeek}
                  />
                </div>
                <span className="time-label">{formatTime(duration)}</span>
              </div>
            </div>

            {/* ── RIGHT: volume + collapse ── */}
            <div className="player-right">
              <button className="ctrl-btn ctrl-sm ctrl-mute" onClick={toggleMute} title={volume === 0 ? 'Unmute' : 'Mute'}>
                {volume === 0
                  ? <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M16.5 12A4.5 4.5 0 0014 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" /></svg>
                  : volume < 0.4
                    ? <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M18.5 12A4.5 4.5 0 0016 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z" /></svg>
                    : <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0014 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" /></svg>
                }
              </button>
              <input
                type="range"
                className="volume-input"
                min="0" max="1" step="0.02"
                value={volume}
                onChange={handleVolumeChange}
              />
              <button
                className={`ctrl-btn ctrl-sm ${showRightPanel ? 'ctrl-active' : ''}`}
                onClick={() => setShowRightPanel(p => !p)}
                title="Up Next / Lyrics"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                  <path d="M3 18h13v-2H3v2zm0-5h10v-2H3v2zm0-7v2h13V6H3zm18 9.59L17.42 12 21 8.41 19.59 7l-5 5 5 5L21 15.59z" />
                </svg>
              </button>
              <button
                className={`ctrl-btn ctrl-sm collapse-btn ${activeNav === 'player' ? 'ctrl-active' : ''}`}
                onClick={() => { setActiveNav(activeNav === 'player' ? 'home' : 'player'); window.scrollTo(0,0); }}
                title={activeNav === 'player' ? 'Close player' : 'Open player'}
              >
                <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"
                  style={{ transform: activeNav === 'player' ? 'rotate(180deg)' : 'none', transition: '0.2s' }}>
                  <path d="M7 10l5 5 5-5z" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}


      {/* ── Right Panel: UP NEXT / LYRICS / RELATED ── */}
      {currentSong && showRightPanel && (
        <div className="right-panel">

          {/* Tabs header */}
          <div className="rp-tabs">
            {['upnext', 'lyrics', 'related'].map(tab => (
              <button
                key={tab}
                className={`rp-tab ${rightPanelTab === tab ? 'active' : ''}`}
                onClick={() => setRightPanelTab(tab)}
              >
                {tab === 'upnext' ? 'UP NEXT' : tab === 'lyrics' ? 'LYRICS' : 'RELATED'}
              </button>
            ))}
            <button className="rp-close" onClick={() => setShowRightPanel(false)} title="Close">
              <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
            </button>
          </div>

          {/* ── UP NEXT tab ── */}
          {rightPanelTab === 'upnext' && (
            <div className="rp-content">
              <div className="rp-playing-from-row">
                <div className="rp-playing-from">
                  <span>Playing from</span>
                  <strong>{listLabel || 'Your Queue'}</strong>
                </div>
                <button className="rp-save-btn">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M14 10H2v2h12v-2zm0-4H2v2h12V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM2 16h8v-2H2v2z" /></svg>
                  Save
                </button>
              </div>
              <div className="rp-song-list">
                {/* Currently playing */}
                <div className="rp-song-item rp-current">
                  <div className="rp-song-thumb-wrapper">
                    <img src={currentSong.image?.[1]?.link || currentSong.image?.[0]?.link} className="rp-song-thumb" alt="" />
                    <div className="rp-thumb-overlay">
                      {isBuffering ? (
                        <div className="spinner-ring" style={{ width: '20px', height: '20px', borderWidth: '2px' }}></div>
                      ) : isPlaying ? (
                        <svg viewBox="0 0 24 24" fill="white" width="18" height="18"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" /></svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="white" width="18" height="18"><path d="M8 5v14l11-7z" /></svg>
                      )}
                    </div>
                  </div>
                  <div className="rp-song-info">
                    <h2 title={decodeText(currentSong.name)} className="mobile-title">{decodeText(currentSong.name)}</h2>
                    <p className="rp-song-artist">{currentSong.artists?.primary?.map(a => a.name).join(', ')}</p>
                  </div>
                  <span className="rp-song-dur">{formatTime(duration)}</span>
                </div>
                {/* Upcoming from current queue */}
                {queue.slice(currentIndex + 1, currentIndex + 20).map((song, i) => (
                  <div key={song.id} className="rp-song-item"
                    onClick={() => playSong(song, currentMood, currentIndex + 1 + i)}>
                    <img src={song.image?.[1]?.link || song.image?.[0]?.link} className="rp-song-thumb" alt="" />
                    <div className="rp-song-info">
                      <p className="rp-song-name">{decodeText(song.name)}</p>
                      <p className="rp-song-artist">{song.artists?.primary?.map(a => a.name).join(', ')}</p>
                    </div>
                    <span className="rp-song-dur">{formatTime(song.duration)}</span>
                  </div>
                ))}
                {/* AI queued songs */}
                {nextQueue.slice(0, 5).map(song => (
                  <div key={song.id} className="rp-song-item rp-ai-queued"
                    onClick={() => playSong(song, currentMood)}>
                    <img src={song.image?.[1]?.link || song.image?.[0]?.link} className="rp-song-thumb" alt="" />
                    <div className="rp-song-info">
                      <p className="rp-song-name">{decodeText(song.name)}</p>
                      <p className="rp-song-artist rp-ai-tag">✨ AI Pick · {song.artists?.primary?.map(a => a.name).join(', ')}</p>
                    </div>
                    <span className="rp-song-dur">{formatTime(song.duration)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── LYRICS tab ── */}
          {rightPanelTab === 'lyrics' && (
            <div className="rp-content rp-lyrics-wrap" ref={lyricsScrollRef}>
              {lyricsLoading && (
                <div className="lyrics-state">
                  <div className="lyrics-loading-wave">
                    <span /><span /><span /><span /><span />
                  </div>
                  <p>Loading lyrics...</p>
                </div>
              )}
              {!lyricsLoading && !lyricsAvailable && (
                <div className="lyrics-state">
                  <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>🎵</div>
                  <p>No lyrics found for this song.</p>
                  <p style={{ fontSize: '12px', marginTop: '8px', color: 'var(--text3)' }}>Try a different song.</p>
                </div>
              )}
              {!lyricsLoading && lyricsAvailable && (
                <div className="lyrics-scroll">
                  {lyrics.map((line, idx) => (
                    <div
                      key={idx}
                      ref={idx === activeLyricIdx ? activeLyricRef : null}
                      className={`lyric-line ${idx === activeLyricIdx ? 'active' : ''} ${idx < activeLyricIdx ? 'past' : ''}`}
                      onClick={() => {
                        if (audioRef.current && line.time > 0) {
                          audioRef.current.currentTime = line.time;
                          setProgress((line.time / duration) * 100);
                        }
                      }}
                    >
                      <p className="lyric-text">{line.text}</p>
                      {line.romanized && <p className="lyric-roman">{line.romanized}</p>}
                    </div>
                  ))}
                  <div style={{ height: '60px' }} />
                </div>
              )}
            </div>
          )}

          {/* ── RELATED tab ── */}
          {rightPanelTab === 'related' && (
            <div className="rp-content">
              {nextQueue.length > 0 ? (
                <div className="rp-song-list">
                  <div className="rp-section-label">Recommended for you ✨</div>
                  {nextQueue.slice(0, 20).map(song => (
                    <div key={song.id} className="rp-song-item"
                      onClick={() => playSong(song, currentMood)}>
                      <img src={song.image?.[1]?.link || song.image?.[0]?.link} className="rp-song-thumb" alt="" />
                      <div className="rp-song-info">
                        <p className="rp-song-name">{decodeText(song.name)}</p>
                        <p className="rp-song-artist">{song.artists?.primary?.map(a => a.name).join(', ')}</p>
                      </div>
                      <span className="rp-song-dur">{formatTime(song.duration)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="lyrics-state">
                  <div style={{ fontSize: '2rem', marginBottom: '12px' }}>🎲</div>
                  <p>Play a song to get recommendations.</p>
                </div>
              )}
            </div>
          )}

        </div>
      )}
      {selectionMode && (
        <div className="selection-action-bar" style={{ position: 'fixed', bottom: '80px', left: '50%', transform: 'translateX(-50%)', background: 'var(--red)', color: 'white', padding: '12px 24px', borderRadius: '30px', display: 'flex', alignItems: 'center', gap: '20px', boxShadow: '0 8px 30px rgba(239, 68, 68, 0.4)', zIndex: 1000, transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)' }}>
          <span style={{ fontWeight: 700, fontSize: '14px' }}>{selectedIds.size} selected</span>
          <div style={{ width: '1px', height: '20px', background: 'rgba(255,255,255,0.3)' }} />
          <button 
            onClick={handleDeleteDownloads} 
            disabled={!selectedIds.size}
            style={{ background: 'white', color: 'var(--red)', border: 'none', padding: '6px 14px', borderRadius: '20px', fontWeight: 700, fontSize: '13px', cursor: selectedIds.size ? 'pointer' : 'not-allowed', opacity: selectedIds.size ? 1 : 0.6 }}
          >
            Delete Forever
          </button>
        </div>
      )}

      {/* ── Mobile Bottom Navigation ── */}
      <nav className={`bottom-nav ${(!showBottomNav || activeNav === 'player') ? 'nav-hidden' : ''}`}>
        <button className={`bottom-nav-item ${activeNav === 'home' ? 'active' : ''}`} onClick={() => { setActiveNav('home'); loadHomeFeed(); window.scrollTo({top: 0, behavior: 'smooth'}); }}>
          <span className="bottom-nav-icon">🏠</span>
          <span>Home</span>
        </button>
        <button className={`bottom-nav-item ${activeNav === 'library' ? 'active' : ''}`} onClick={() => setActiveNav('library')}>
          <span className="bottom-nav-icon">📁</span>
          <span>Library</span>
        </button>
        <button className={`bottom-nav-item ${activeNav === 'player' ? 'active' : ''}`} onClick={() => setActiveNav('player')}>
          <span className="bottom-nav-icon">
            {isPlaying ? <div className="nav-playing-dot" /> : '🎵'}
          </span>
          <span>Player</span>
        </button>
        <button className={`bottom-nav-item ${activeNav === 'replay' ? 'active' : ''}`} onClick={() => setActiveNav('replay')}>
          <span className="bottom-nav-icon">📊</span>
          <span>Replay</span>
        </button>
        <button className={`bottom-nav-item ${activeNav === 'about' ? 'active' : ''}`} onClick={() => setActiveNav('about')}>
          <span className="bottom-nav-icon">👨‍💻</span>
          <span>Creator</span>
        </button>
      </nav>

    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('playwdebarpan_v3_user')); } catch { return null; }
  });

  const saveUser = (u) => {
    localStorage.setItem('playwdebarpan_v3_user', JSON.stringify(u));
    setUser(u);
  };

  const logout = () => {
    localStorage.removeItem('playwdebarpan_v3_user');
    setUser(null);
  };

  if (!user) return <Login onLogin={saveUser} />;
  if (!user.onboarded) return <Onboarding user={user} onComplete={saveUser} />;
  return <MainApp user={user} logout={logout} />;
}

function Login({ onLogin }) {
  const [name, setName] = useState('');

  const submit = (e) => {
    e.preventDefault();
    if (!name.trim()) return alert('Please enter your name to personalize your experience!');
    // Simple profile: just name, others will be filled in Onboarding
    onLogin({ name: name.trim(), username: `user_${Date.now()}`, onboarded: false, genres: [], artists: [] });
  };

  return (
    <div className="auth-layout">
      <div className="auth-box">
        <div className="auth-logo" style={{ overflow: 'visible' }}>
          <img className="app-logo" src="/logo.jpg" alt="Dil Se Suno" style={{ width: '100%', maxWidth: '300px', height: 'auto', marginBottom: '16px' }} />
          <p style={{ color: 'var(--text2)', fontSize: '14px', marginTop: '4px' }}>Enter your name to start your musical journey</p>
        </div>
        <form className="auth-form" onSubmit={submit}>
          <input 
            className="auth-input" 
            placeholder="Your Name" 
            value={name} 
            onChange={e => setName(e.target.value)} 
            autoFocus 
          />
          <button className="auth-btn" type="submit">Start Listening</button>
        </form>
      </div>
    </div>
  );
}

function MonthlyReplay() {
  const allStats = loadMonthlyStats();
  const availableMonths = Object.keys(allStats).sort().reverse();
  const [selectedMonth, setSelectedMonth] = useState(availableMonths[0] || getMonthKey());

  const data = allStats[selectedMonth] || { songs: {}, artists: {}, genres: {}, totalMs: 0 };

  const topSongs = Object.entries(data.songs).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const topArtists = Object.entries(data.artists)
    .filter(([name]) => name && name.toLowerCase() !== 'unknown' && name !== '—')
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const topGenres = Object.entries(data.genres).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const totalMin = Math.round((data.totalMs || 0) / 60000);
  const totalHours = (totalMin / 60).toFixed(1);

  const monthLabel = (key) => {
    if (!key) return '';
    const [y, m] = key.split('-');
    return new Date(Number(y), Number(m) - 1).toLocaleString('default', { month: 'long', year: 'numeric' });
  };

  const maxSongCount = topSongs[0]?.[1] || 1;
  const maxArtistCount = topArtists[0]?.[1] || 1;

  return (
    <div style={{ padding: '32px', maxWidth: '960px', margin: '0 auto', color: 'var(--text)', animation: 'fadeIn 0.4s ease' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 style={{ fontSize: '36px', fontWeight: 800, background: 'linear-gradient(90deg, var(--red), #ff7e67)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', margin: 0 }}>
            Monthly Replay
          </h1>
          <p style={{ color: 'var(--text2)', marginTop: '6px' }}>Your personal music stats, month by month</p>
        </div>
        <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}
          style={{ padding: '12px 20px', borderRadius: '12px', background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', fontSize: '15px', cursor: 'pointer', outline: 'none' }}>
          {availableMonths.length === 0
            ? <option value={getMonthKey()}>{monthLabel(getMonthKey())}</option>
            : availableMonths.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)
          }
        </select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '20px', marginBottom: '36px' }}>
        {[
          { label: 'Total Minutes', value: totalMin, icon: '⏱️', sub: `${totalHours} hours` },
          { label: 'Songs Played', value: Object.keys(data.songs).length, icon: '🎵', sub: 'unique tracks' },
          { label: 'Top Artists', value: topArtists.length, icon: '🎤', sub: 'artists listened' },
          { label: 'Genres', value: Object.keys(data.genres).length || '—', icon: '🎼', sub: 'genres explored' },
        ].map(card => (
          <div key={card.label} style={{ background: 'var(--surface)', borderRadius: '20px', padding: '24px', textAlign: 'center', border: '1px solid var(--border)', boxShadow: '0 4px 20px rgba(0,0,0,0.15)' }}>
            <div style={{ fontSize: '32px', marginBottom: '8px' }}>{card.icon}</div>
            <div style={{ fontSize: '36px', fontWeight: 800, color: 'var(--red)' }}>{card.value}</div>
            <div style={{ color: 'var(--text)', fontWeight: 600, marginTop: '4px' }}>{card.label}</div>
            <div style={{ color: 'var(--text2)', fontSize: '12px', marginTop: '2px' }}>{card.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px' }}>
        <div style={{ background: 'var(--surface)', borderRadius: '20px', padding: '28px', border: '1px solid var(--border)' }}>
          <h2 style={{ color: 'var(--red)', marginBottom: '20px', fontSize: '18px' }}>🎵 Top Songs</h2>
          {topSongs.length === 0
            ? <p style={{ color: 'var(--text2)' }}>No data yet — start listening!</p>
            : topSongs.map(([name, count], i) => (
              <div key={name} style={{ marginBottom: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{ color: 'var(--text)', fontWeight: i === 0 ? 700 : 400, fontSize: '14px', flex: 1, marginRight: '8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`} {name}
                  </span>
                  <span style={{ color: 'var(--text2)', fontSize: '13px', whiteSpace: 'nowrap' }}>{count} plays</span>
                </div>
                <div style={{ height: '4px', background: 'var(--border)', borderRadius: '4px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${(count / maxSongCount) * 100}%`, background: 'linear-gradient(90deg, var(--red), #ff7e67)', borderRadius: '4px', transition: 'width 0.6s ease' }} />
                </div>
              </div>
            ))
          }
        </div>

        <div style={{ background: 'var(--surface)', borderRadius: '20px', padding: '28px', border: '1px solid var(--border)' }}>
          <h2 style={{ color: 'var(--red)', marginBottom: '20px', fontSize: '18px' }}>🎤 Top Artists</h2>
          {topArtists.length === 0
            ? <p style={{ color: 'var(--text2)' }}>No data yet — start listening!</p>
            : topArtists.map(([name, count], i) => (
              <div key={name} style={{ marginBottom: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{ color: 'var(--text)', fontWeight: i === 0 ? 700 : 400, fontSize: '14px' }}>
                    {['🥇', '🥈', '🥉', '4️⃣', '5️⃣'][i]} {name}
                  </span>
                  <span style={{ color: 'var(--text2)', fontSize: '13px' }}>{count} plays</span>
                </div>
                <div style={{ height: '4px', background: 'var(--border)', borderRadius: '4px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${(count / maxArtistCount) * 100}%`, background: 'linear-gradient(90deg, #6c63ff, #9b89fa)', borderRadius: '4px', transition: 'width 0.6s ease' }} />
                </div>
              </div>
            ))
          }
          {topGenres.length > 0 && (
            <div style={{ marginTop: '28px' }}>
              <h2 style={{ color: 'var(--red)', marginBottom: '16px', fontSize: '18px' }}>🎼 Top Genres</h2>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                {topGenres.map(([genre, count]) => (
                  <span key={genre} style={{ padding: '8px 16px', background: 'rgba(255,0,0,0.1)', color: 'var(--red)', borderRadius: '24px', fontSize: '13px', fontWeight: 600, border: '1px solid rgba(255,0,0,0.2)' }}>
                    {genre} · {count}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {availableMonths.length === 0 && (
        <div style={{ marginTop: '40px', textAlign: 'center', color: 'var(--text2)', padding: '40px', background: 'var(--surface)', borderRadius: '20px', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🎧</div>
          <p style={{ fontSize: '18px', marginBottom: '8px' }}>No listening data yet for this month!</p>
          <p style={{ fontSize: '14px' }}>Start playing some songs and your stats will appear here automatically.</p>
        </div>
      )}
    </div>
  );
}

const ONBOARDING_GENRES = ['Bollywood', 'Punjabi', 'Lofi', 'Pop', 'Retro', 'Devotional', 'Hip Hop', 'Indie', 'Acoustic'];
const ONBOARDING_ARTISTS_DEFAULT = [
  { name: 'Arijit Singh', img: 'https://c.saavncdn.com/artists/Arijit_Singh_004_20241118063717_150x150.jpg' },
  { name: 'Badshah', img: 'https://c.saavncdn.com/artists/Badshah_005_20230608084021_150x150.jpg' },
  { name: 'Shreya Ghoshal', img: 'https://c.saavncdn.com/artists/Shreya_Ghoshal_004_20231128073541_150x150.jpg' },
  { name: 'Diljit Dosanjh', img: 'https://c.saavncdn.com/artists/Diljit_Dosanjh_004_20231025071115_150x150.jpg' },
  { name: 'AP Dhillon', img: 'https://c.saavncdn.com/artists/AP_Dhillon_001_20231011082645_150x150.jpg' },
  { name: 'AR Rahman', img: 'https://c.saavncdn.com/artists/AR_Rahman_002_20210120084534_150x150.jpg' },
  { name: 'Pritam', img: 'https://c.saavncdn.com/artists/Pritam_003_20231114065604_150x150.jpg' },
  { name: 'Taylor Swift', img: 'https://c.saavncdn.com/artists/Taylor_Swift_001_20231031154332_150x150.jpg' },
  { name: 'Kishore Kumar', img: 'https://c.saavncdn.com/artists/Kishore_Kumar_002_20231110080838_150x150.jpg' },
  { name: 'Ed Sheeran', img: 'https://c.saavncdn.com/artists/Ed_Sheeran_150x150.jpg' },
];

function Onboarding({ user, onComplete }) {
  const [selectedGenres, setSelectedGenres] = useState([]);
  const [selectedArtists, setSelectedArtists] = useState([]);
  const [artistQuery, setArtistQuery] = useState('');
  const [searchedArtists, setSearchedArtists] = useState([]);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    if (!artistQuery.trim()) { setSearchedArtists([]); return; }
    const timer = setTimeout(() => {
      setIsSearching(true);
      axios.get(`/api/search-artists?query=${encodeURIComponent(artistQuery)}`)
        .then(r => setSearchedArtists(r.data?.data || []))
        .catch(() => { })
        .finally(() => setIsSearching(false));
    }, 500);
    return () => clearTimeout(timer);
  }, [artistQuery]);

  const toggleGenre = (g) => setSelectedGenres(prev => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g]);
  const toggleArtist = (a) => setSelectedArtists(prev => prev.includes(a) ? prev.filter(x => x !== a) : [...prev, a]);

  const displayedArtists = artistQuery.trim() ? searchedArtists : ONBOARDING_ARTISTS_DEFAULT;

  return (
    <div className="onboarding-screen">
      <div className="onboarding-header">
        <h2>Welcome, {user.name}! Let's build your AI Profile.</h2>
        <p>Pick your favorite vibes and artists to perfectly tune your recommendations.</p>
      </div>
      <div className="onboarding-content">
        <h3 style={{ color: 'var(--text1)', marginBottom: '24px', fontSize: '20px' }}>1. Select Genres</h3>
        <div className="genre-grid">
          {ONBOARDING_GENRES.map(g => (
            <div key={g} className={`genre-card ${selectedGenres.includes(g) ? 'selected' : ''}`} onClick={() => toggleGenre(g)}>
              {g}
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '24px', marginTop: '24px' }}>
          <h3 style={{ color: 'var(--text1)', margin: 0, fontSize: '20px' }}>2. Select Artists</h3>
          <input
            type="text"
            placeholder="Search 1000+ artists..."
            value={artistQuery}
            onChange={e => setArtistQuery(e.target.value)}
            style={{ padding: '10px 16px', borderRadius: '24px', outline: 'none', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: 'white', fontSize: '14px', width: '250px' }}
          />
        </div>

        {isSearching ? <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text2)' }}>Searching database...</div> : (
          <div className="artist-grid">
            {displayedArtists.map(a => {
              const initials = a.name.split(' ').map(w => w[0]).join('').substring(0, 2);
              const isSelected = selectedArtists.includes(a.name);
              return (
                <div key={a.name} className={`artist-card ${isSelected ? 'selected' : ''}`} onClick={() => toggleArtist(a.name)}>
                  <div className="artist-avatar-lg" style={a.img ? { backgroundImage: `url(${a.img})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}}>
                    {!a.img && initials}
                  </div>
                  <div className="artist-card-name" style={{ wordBreak: 'break-word', padding: '0 8px' }}>{a.name}</div>
                </div>
              );
            })}
          </div>
        )}
        {displayedArtists.length === 0 && !isSearching && <div style={{ textAlign: 'center', color: 'var(--text2)', padding: '20px' }}>No artists found for "{artistQuery}"</div>}
      </div>
      <div className="onboarding-footer">
        <div className="onboarding-btn-wrap">
          <button className="btn-finish"
            onClick={() => onComplete({ ...user, onboarded: true, genres: selectedGenres, artists: selectedArtists })}
            disabled={selectedGenres.length === 0 && selectedArtists.length === 0}>
            Finish Setup
          </button>
        </div>
      </div>
    </div>
  );
}

function AboutCreator() {
  return (
    <div className="about-creator">
      <div className="creator-profile">
        <img className="creator-img" src="/dc-photo.png" alt="Debarpan Chaudhuri" />
        <div className="creator-details">
          <h1 className="creator-name">Debarpan Chaudhuri</h1>
          <p className="creator-headline">Student @ SRM IST Chennai | BTech in Computer Science</p>
          <div className="creator-contact">
            <span>📍 Greater Chennai Area</span>
            <span>✉️ debarpanchaudhuri@gmail.com</span>
          </div>
        </div>
      </div>

      <div style={{ marginBottom: '40px' }}>
        <h2 style={{ borderBottom: '2px solid rgba(255,255,255,0.05)', paddingBottom: '12px', marginBottom: '20px', color: 'var(--red)' }}>Summary</h2>
        <p style={{ color: 'var(--text2)', lineHeight: '1.8', fontSize: '16px' }}>Currently pursuing a Bachelor of Technology in Computer Science Engineering with a specialization in Artificial Intelligence and Machine Learning at SRM IST Chennai. Passionate about building intelligent, seamless digital experiences bridging AI architecture with premium UI/UX design.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 350px), 1fr))', gap: '40px', marginBottom: '40px' }}>
        <div style={{ background: 'var(--surface-light)', padding: '32px', borderRadius: '20px' }}>
          <h2 style={{ borderBottom: '2px solid rgba(255,255,255,0.05)', paddingBottom: '12px', marginBottom: '20px', color: 'var(--red)' }}>Experience</h2>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, color: 'var(--text2)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <li><strong style={{ color: 'var(--text1)', fontSize: '18px' }}>Fortinet</strong><br />Network Security Intern <span style={{ color: 'var(--text3)', fontSize: '14px', marginLeft: '8px' }}>April 2026 - Present</span></li>
            <li><strong style={{ color: 'var(--text1)', fontSize: '18px' }}>UiPath</strong><br />Automation Developer Intern <span style={{ color: 'var(--text3)', fontSize: '14px', marginLeft: '8px' }}>Jan - Mar 2026</span></li>
            <li><strong style={{ color: 'var(--text1)', fontSize: '18px' }}>Google for Developers</strong><br />AI-ML Intern <span style={{ color: 'var(--text3)', fontSize: '14px', marginLeft: '8px' }}>Oct - Dec 2025</span></li>
            <li><strong style={{ color: 'var(--text1)', fontSize: '18px' }}>BridgeLabz</strong><br />Java 100 Coding Hours <span style={{ color: 'var(--text3)', fontSize: '14px', marginLeft: '8px' }}>Aug - Oct 2025</span></li>
            <li><strong style={{ color: 'var(--text1)', fontSize: '18px' }}>Placfv's</strong><br />Member of Creative's <span style={{ color: 'var(--text3)', fontSize: '14px', marginLeft: '8px' }}>Oct 2025 - Present</span></li>
          </ul>
        </div>
        <div style={{ background: 'var(--surface-light)', padding: '32px', borderRadius: '20px' }}>
          <h2 style={{ borderBottom: '2px solid rgba(255,255,255,0.05)', paddingBottom: '12px', marginBottom: '20px', color: 'var(--red)' }}>Top Projects</h2>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, color: 'var(--text2)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <li><strong style={{ color: 'var(--text1)', fontSize: '18px' }}>Library Management System (LMS)</strong><br />Web-based application using Java, JDBC, and MySQL GUI</li>
            <li><strong style={{ color: 'var(--text1)', fontSize: '18px' }}>AI Weather Pattern Data Explorer</strong><br />MySQL & Flask integrations</li>
            <li><strong style={{ color: 'var(--text1)', fontSize: '18px' }}>Satark Setu</strong><br />Disaster Management Telegram Bot</li>
            <li><strong style={{ color: 'var(--text1)', fontSize: '18px' }}>Deadlock Detective</strong><br />Interactive OS deadlock simulation game</li>
          </ul>
        </div>
      </div>

      <div style={{ background: 'var(--surface)', padding: '32px', borderRadius: '20px' }}>
        <h2 style={{ borderBottom: '2px solid rgba(255,255,255,0.05)', paddingBottom: '12px', marginBottom: '20px', color: 'var(--red)' }}>Education & Top Skills</h2>
        <div style={{ display: 'flex', gap: '40px', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 300px' }}>
            <strong style={{ color: 'var(--text1)', fontSize: '18px' }}>SRM IST Chennai</strong><br />
            <span style={{ color: 'var(--text2)', lineHeight: '1.6' }}>BTech Computer Science (AI & ML)<br />Aug 2024 - Aug 2028</span>
            <div style={{ marginTop: '16px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <span style={{ padding: '6px 12px', background: 'rgba(255,255,255,0.1)', borderRadius: '16px', fontSize: '13px' }}>User Interface Design</span>
              <span style={{ padding: '6px 12px', background: 'rgba(255,255,255,0.1)', borderRadius: '16px', fontSize: '13px' }}>User Experience (UX)</span>
              <span style={{ padding: '6px 12px', background: 'rgba(255,255,255,0.1)', borderRadius: '16px', fontSize: '13px' }}>Video Editing</span>
            </div>

            <div style={{ marginTop: '24px' }}>
              <strong style={{ color: 'var(--text1)', fontSize: '18px' }}>Holy Home</strong><br />
              <span style={{ color: 'var(--text2)', lineHeight: '1.6' }}>Senior Secondary Education, Computer Science<br />Apr 2022 - May 2024</span>
            </div>

            <div style={{ marginTop: '24px' }}>
              <strong style={{ color: 'var(--text1)', fontSize: '18px' }}>Modern Public School</strong><br />
              <span style={{ color: 'var(--text2)', lineHeight: '1.6' }}>Secondary Education, Computer Science<br />Apr 2020 - Mar 2022</span>
            </div>
          </div>
          <div style={{ flex: '1 1 300px', color: 'var(--text2)' }}>
            <ul style={{ margin: 0, paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '14px' }}>
              <li><strong>Cisco</strong> — Certified Networking Basics</li>
              <li><strong>Cambridge</strong> — Certified UI UX Strategist</li>
              <li><strong>UiPath</strong> — Automation Developer Associate Training</li>
              <li><strong>NVIDIA</strong> — Building RAG Agents with LLMs Certification</li>
              <li><strong>Product Space</strong> — AI Product Management Micro Certification</li>
              <li><strong>Jio Institute</strong> — AI Classroom Foundation</li>
              <li><strong>Intel</strong> — Certified RAG for Production (LangChain & LlamaIndex)</li>
              <li><strong>Oracle</strong> — Cloud Infrastructure 2025 Gen AI Professional</li>
              <li><strong>OpenAI</strong> — GenAI Mastery Certificate</li>
              <li><strong>Microsoft</strong> — Certified Generative AI Foundations</li>
            </ul>
          </div>
        </div>
      </div>

      {/* ── Social Links ── */}
      <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', marginTop: '36px', paddingBottom: '8px', flexWrap: 'wrap' }}>
        <a
          href="https://www.linkedin.com/in/debarpan-chaudhuri-4325081b7/"
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 28px', background: '#0A66C2', color: '#fff', borderRadius: '14px', textDecoration: 'none', fontWeight: 600, fontSize: '15px', boxShadow: '0 4px 20px rgba(10,102,194,0.45)', transition: 'transform 0.2s, box-shadow 0.2s' }}
          onMouseOver={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 8px 28px rgba(10,102,194,0.6)'; }}
          onMouseOut={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 20px rgba(10,102,194,0.45)'; }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="white">
            <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
          </svg>
          LinkedIn
        </a>
        <a
          href="https://www.instagram.com/_debarpan_chaudhuri_/"
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 28px', background: 'linear-gradient(135deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)', color: '#fff', borderRadius: '14px', textDecoration: 'none', fontWeight: 600, fontSize: '15px', boxShadow: '0 4px 20px rgba(220,39,67,0.4)', transition: 'transform 0.2s, box-shadow 0.2s' }}
          onMouseOver={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 8px 28px rgba(220,39,67,0.6)'; }}
          onMouseOut={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 20px rgba(220,39,67,0.4)'; }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="white">
            <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z" />
          </svg>
          Instagram
        </a>
      </div>
    </div>
  );
}
