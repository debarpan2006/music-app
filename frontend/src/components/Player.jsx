// Player Component
// Usage: <Player currentSong={currentSong} isPlaying={isPlaying} progress={progress} onToggle={togglePlay} onSeek={handleSeek} audioRef={audioRef} onTimeUpdate={handleTimeUpdate} onEnded={handleEnded} />

export default function Player({ currentSong, isPlaying, progress, onToggle, onSeek, audioRef, onTimeUpdate, onEnded }) {
  if (!currentSong) return null;

  return (
    <div className="player">
      <img src={currentSong.image?.[1]?.url} alt="" className="player-img" />
      <div className="player-info">
        <p className="player-title">{currentSong.name}</p>
        <p className="player-artist">
          {currentSong.artists?.primary?.map(a => a.name).join(', ')}
        </p>
      </div>
      <div className="player-controls">
        <button onClick={onToggle} className="play-btn">
          {isPlaying ? '⏸' : '▶'}
        </button>
      </div>
      <div className="progress-bar">
        <input
          type="range"
          min="0"
          max="100"
          value={progress}
          onChange={onSeek}
        />
      </div>
      <audio
        ref={audioRef}
        onTimeUpdate={onTimeUpdate}
        onEnded={onEnded}
      />
    </div>
  );
}
