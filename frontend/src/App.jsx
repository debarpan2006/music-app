import { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import './App.css';

export default function App() {
  const [query, setQuery] = useState('');
  const [songs, setSongs] = useState([]);
  const [currentSong, setCurrentSong] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [loading, setLoading] = useState(false);
  const audioRef = useRef(null);

  useEffect(() => {
    axios.get('http://localhost:5000/api/charts')
      .then(res => setSongs(res.data?.data?.results || []));
  }, []);

  const searchSongs = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    const res = await axios.get(`http://localhost:5000/api/search?query=${query}`);
    setSongs(res.data?.data?.results || []);
    setLoading(false);
  };

  const playSong = (song) => {
    const url = song.downloadUrl?.[4]?.url || song.downloadUrl?.[2]?.url;
    if (!url) return;
    setCurrentSong(song);
    if (audioRef.current) {
      audioRef.current.src = url;
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleTimeUpdate = () => {
    const { currentTime, duration } = audioRef.current;
    setProgress((currentTime / duration) * 100 || 0);
  };

  const handleSeek = (e) => {
    const newTime = (e.target.value / 100) * audioRef.current.duration;
    audioRef.current.currentTime = newTime;
    setProgress(e.target.value);
  };

  return (
    <div className="app">
      <div className="header">
        <h1>🎵 MusicApp</h1>
        <form onSubmit={searchSongs} className="search-bar">
          <input
            type="text"
            placeholder="Search songs, artists..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="submit">Search</button>
        </form>
      </div>

      <div className="song-list">
        {loading && <p className="loading">Searching...</p>}
        {songs.map((song) => (
          <div
            key={song.id}
            className={`song-card ${currentSong?.id === song.id ? 'active' : ''}`}
            onClick={() => playSong(song)}
          >
            <img src={song.image?.[1]?.url} alt={song.name} className="song-img" />
            <div className="song-info">
              <p className="song-name">{song.name}</p>
              <p className="song-artist">
                {song.artists?.primary?.map(a => a.name).join(', ')}
              </p>
            </div>
            <span className="play-icon">
              {currentSong?.id === song.id && isPlaying ? '⏸' : '▶'}
            </span>
          </div>
        ))}
      </div>

      {currentSong && (
        <div className="player">
          <img src={currentSong.image?.[1]?.url} alt="" className="player-img" />
          <div className="player-info">
            <p className="player-title">{currentSong.name}</p>
            <p className="player-artist">
              {currentSong.artists?.primary?.map(a => a.name).join(', ')}
            </p>
          </div>
          <div className="player-controls">
            <button onClick={togglePlay} className="play-btn">
              {isPlaying ? '⏸' : '▶'}
            </button>
          </div>
          <div className="progress-bar">
            <input
              type="range"
              min="0"
              max="100"
              value={progress}
              onChange={handleSeek}
            />
          </div>
          <audio
            ref={audioRef}
            onTimeUpdate={handleTimeUpdate}
            onEnded={() => setIsPlaying(false)}
          />
        </div>
      )}
    </div>
  );
}
