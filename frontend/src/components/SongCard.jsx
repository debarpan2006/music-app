// SongCard Component
// Usage: <SongCard song={song} isActive={isActive} isPlaying={isPlaying} onClick={playSong} />

export default function SongCard({ song, isActive, isPlaying, onClick }) {
  return (
    <div
      className={`song-card ${isActive ? 'active' : ''}`}
      onClick={() => onClick(song)}
    >
      <img
        src={song.image?.[1]?.url}
        alt={song.name}
        className="song-img"
      />
      <div className="song-info">
        <p className="song-name">{song.name}</p>
        <p className="song-artist">
          {song.artists?.primary?.map(a => a.name).join(', ')}
        </p>
      </div>
      <span className="play-icon">
        {isActive && isPlaying ? '⏸' : '▶'}
      </span>
    </div>
  );
}
