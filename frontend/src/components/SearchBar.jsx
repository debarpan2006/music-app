// SearchBar Component
// Usage: <SearchBar query={query} setQuery={setQuery} onSearch={searchSongs} />

export default function SearchBar({ query, setQuery, onSearch }) {
  return (
    <form onSubmit={onSearch} className="search-bar">
      <input
        type="text"
        placeholder="Search songs, artists..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <button type="submit">Search</button>
    </form>
  );
}
