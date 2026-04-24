require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const OpenAI = require('openai');
const YTMusic = require('ytmusic-api');

const ytmusic = new YTMusic();

const YT_AUTH = process.env.YT_AUTH || ""; // User can set this in Vercel/Environment
const YOUTUBE_API_KEY = "AIzaSyB9V4KTQ7IfinBKw6-P85CAz7zPI9_Jaho"; // Official Google Cloud Key

async function initYT() {
  try {
    if (YT_AUTH) {
      await ytmusic.initialize(YT_AUTH);
      console.log("YTMusic initialized with AUTH");
    } else {
      await ytmusic.initialize();
      console.log("YTMusic initialized (Public)");
    }
  } catch (e) {
    console.error("YTMusic Init Error:", e.message);
  }
}

initYT();

let appleToken = null;
async function fetchAppleToken() {
  const mainPageURL = 'https://beta.music.apple.com';
  const mainPageResponse = await axios.get(mainPageURL);
  const mainPageBody = mainPageResponse.data;
  const jsFileRegex = /\/assets\/[^"'>]+\.js/g;
  const jsFiles = mainPageBody.match(jsFileRegex) || [];
  for (const uri of jsFiles) {
    if (!uri.includes('index-')) continue;
    try {
      const res = await axios.get(mainPageURL + uri);
      const tokenRegex = /"?(eyJh[^"]+)"?/;
      const match = res.data.match(tokenRegex);
      if (match && match[1]) {
        appleToken = match[1];
        return appleToken;
      }
    } catch (e) {}
  }
  throw new Error('Apple token not found');
}
// Initial fetch
fetchAppleToken().catch(e => console.error("Apple fail:", e.message));

const app = express();
app.use(cors());
app.use(express.json());

const SAAVN_BASE = 'https://jiosaavn-api-privatecvc2.vercel.app';

const nvidia = new OpenAI({
  apiKey: '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', // Hardcoded as requested for seamless deployment
  baseURL: 'https://integrate.api.nvidia.com/v1',
});

// ── Rich artist similarity graph ──────────────────────────────────────────
const SIMILAR_ARTISTS = {
  'arijit singh': ['Jubin Nautiyal', 'Atif Aslam', 'KK', 'Mohit Chauhan', 'Armaan Malik', 'Darshan Raval'],
  'jubin nautiyal': ['Arijit Singh', 'Atif Aslam', 'Darshan Raval', 'Armaan Malik'],
  'atif aslam': ['Arijit Singh', 'KK', 'Rahat Fateh Ali Khan', 'Jubin Nautiyal'],
  'badshah': ['Yo Yo Honey Singh', 'Diljit Dosanjh', 'AP Dhillon', 'Guru Randhawa', 'Nucleya'],
  'ap dhillon': ['Shubh', 'Diljit Dosanjh', 'Sidhu Moosewala', 'Badshah', 'Jasmine Sandlas'],
  'diljit dosanjh': ['AP Dhillon', 'Sidhu Moosewala', 'Prabh Deep', 'Badshah'],
  'ar rahman': ['Harris Jayaraj', 'Anirudh Ravichander', 'D Imman', 'Yuvan Shankar Raja'],
  'anirudh': ['AR Rahman', 'Harris Jayaraj', 'Yuvan Shankar Raja', 'Sid Sriram'],
  'sid sriram': ['Anirudh Ravichander', 'Jonita Gandhi', 'Armaan Malik'],
  'kishore kumar': ['Mohammed Rafi', 'Mukesh', 'Hemant Kumar', 'S D Burman'],
  'lata mangeshkar': ['Asha Bhosle', 'Shreya Ghoshal', 'Kavita Krishnamurthy'],
  'shreya ghoshal': ['Lata Mangeshkar', 'Sunidhi Chauhan', 'Neha Kakkar', 'Jonita Gandhi'],
  'neha kakkar': ['Shreya Ghoshal', 'Tulsi Kumar', 'Sunidhi Chauhan', 'Asees Kaur'],
  'taylor swift': ['Olivia Rodrigo', 'Sabrina Carpenter', 'Ed Sheeran', 'Gracie Abrams', 'Katy Perry'],
  'ed sheeran': ['Taylor Swift', 'Shawn Mendes', 'Charlie Puth', 'Lewis Capaldi'],
  'the weeknd': ['Drake', 'Post Malone', 'Travis Scott', 'SZA'],
  'coldplay': ['Imagine Dragons', 'OneRepublic', 'Maroon 5', 'U2'],
  'imran khan': ['Akon', 'Pitbull', 'Ali Zafar'],
  'armaan malik': ['Arijit Singh', 'Darshan Raval', 'Jubin Nautiyal', 'Akhil'],
  'darshan raval': ['Armaan Malik', 'Jubin Nautiyal', 'Arijit Singh'],
  'pritam': ['Vishal-Shekhar', 'Amit Trivedi', 'Shankar Ehsaan Loy'],
};

const getSimilarArtists = (artistName) => {
  const key = artistName.toLowerCase();
  for (const [k, v] of Object.entries(SIMILAR_ARTISTS)) {
    if (key.includes(k)) return v.slice(0, 3);
  }
  return [];
};

// ── Mood → search query templates ─────────────────────────────────────────
const MOOD_QUERIES = {
  happy: ['feel good hindi songs', 'upbeat bollywood 2024', 'happy pop songs'],
  sad: ['sad arijit singh songs', 'emotional hindi breakup songs', 'melancholic bollywood'],
  romantic: ['romantic bollywood songs 2024', 'love songs hindi latest', 'soft romantic hindi'],
  energetic: ['workout hindi songs', 'energetic dance hits 2024', 'high energy bollywood'],
  chill: ['lofi hindi chill', 'mellow indie hindi songs', 'calm relaxing bollywood'],
  devotional: ['bhajan hindi devotional', 'god songs hindi', 'spiritual hindi music'],
  party: ['party hits 2024 bollywood', 'dance floor hindi songs', 'DJ remix bollywood'],
  focus: ['instrumental focus music', 'study music hindi lofi', 'concentration background music'],
};

// ── Time-based default queries ─────────────────────────────────────────────
const TIME_DEFAULTS = {
  morning: ['fresh morning hindi songs', 'motivational upbeat bollywood', 'sunrise feel-good music'],
  afternoon: ['mid-tempo hindi indie songs', 'focus background music', 'chill afternoon bollywood'],
  evening: ['feel-good evening hindi songs', 'classic bollywood hits evening', 'relaxed Hindi pop'],
  night: ['romantic night hindi songs', 'lofi hindi night chill', 'slow emotional bollywood night'],
};

// ── Helpers ────────────────────────────────────────────────────────────────
const saavnSearch = (query, limit = 15) =>
  axios
    .get(`${SAAVN_BASE}/search/songs?query=${encodeURIComponent(query)}&limit=${limit}`)
    .then((r) => r.data?.data?.results || [])
    .catch(() => []);

const mergeAndDedupe = (arrays, sessionIds = new Set(), maxTotal = 25) => {
  const seen = new Set();
  const results = [];
  for (const arr of arrays) {
    for (const song of arr) {
      if (!seen.has(song.id)) {
        seen.add(song.id);
        song._playedThisSession = sessionIds.has(song.id);
        results.push(song);
      }
    }
  }
  // Unplayed songs first
  return [
    ...results.filter((s) => !s._playedThisSession),
    ...results.filter((s) => s._playedThisSession),
  ].slice(0, maxTotal);
};

// Lightweight "skip-penalty" scorer: skip-heavy songs ranked lower
const scoreAndSort = (songs, history = {}) => {
  return songs.map((s) => {
    const h = history[s.id];
    if (!h) return { ...s, _score: 0 };
    const skipRatio = h.skipCount / Math.max(h.playCount, 1);
    const recencyBonus = h.lastPlayed ? Math.max(0, 1 - (Date.now() - h.lastPlayed) / (7 * 24 * 3600 * 1000)) : 0;
    const score = h.playCount * (1 - skipRatio * 0.6) + recencyBonus * 3;
    return { ...s, _score: score };
  }).sort((a, b) => b._score - a._score);
};

// ── Existing endpoints ─────────────────────────────────────────────────────

app.get('/api/search-artists', async (req, res) => {
  try {
    const { query } = req.query;
    if (!query) return res.json({ data: [] });
    // Fetch Artists from JioSaavn
    const response = await axios.get(`${SAAVN_BASE}/search/artists?query=${encodeURIComponent(query)}&limit=15`);
    const results = response.data?.data?.results || [];

    // Map beautifully to clean images
    const artists = results.map(r => {
      let img = '';
      if (r.image && r.image.length > 0) {
        img = r.image[r.image.length - 1].link || r.image[0].link;
      }
      return { id: r.id, name: r.title || r.name, img };
    }).filter(a => a.name);

    res.json({ data: artists });
  } catch (err) {
    res.status(500).json({ error: 'Artist search failed' });
  }
});

app.get('/api/search', async (req, res) => {
  try {
    const { query, limit } = req.query;
    const maxLimit = limit ? Number(limit) : 500; // Uncapped/large limit for search
    const results = await saavnSearch(query, maxLimit);
    res.json({ data: { results } });
  } catch (err) {
    res.status(500).json({ error: 'Search failed' });
  }
});

// YouTube Music Search Wrapper
app.get('/api/yt/search', async (req, res) => {
  try {
    const { query } = req.query;
    const songs = await ytmusic.searchSongs(query);
    
    // Map YouTube response cleanly onto JioSaavn schema
    const mapped = songs.map(s => ({
      id: "yt_" + s.videoId,
      name: s.name,
      ytVideoId: s.videoId,
      source: "youtube",
      duration: s.duration,
      artists: { primary: [{ name: s.artist?.name || 'Unknown' }] },
      image: [
        { link: s.thumbnails?.[0]?.url || '' },
        { link: s.thumbnails?.[1]?.url || s.thumbnails?.[0]?.url || '' },
        { link: s.thumbnails?.[2]?.url || s.thumbnails?.[s.thumbnails.length-1]?.url || '' }
      ]
    }));

    // Enrichment Step: If Official API Key is present, grab high-res data for the top result
    if (YOUTUBE_API_KEY && mapped.length > 0) {
      try {
        const topVideoId = mapped[0].ytVideoId;
        const enrichRes = await axios.get(`https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${topVideoId}&key=${YOUTUBE_API_KEY}`);
        const info = enrichRes.data?.items?.[0];
        if (info) {
          mapped[0].viewCount = info.statistics.viewCount;
          mapped[0].description = info.snippet.description;
          // Upgrade thumbnail to MaxRes if available
          if (info.snippet.thumbnails.maxres) {
            mapped[0].image[2].link = info.snippet.thumbnails.maxres.url;
          }
        }
      } catch (e) {
        console.error("YT Enrichment fail:", e.message);
      }
    }
    
    res.json({ data: { results: mapped } });
  } catch (err) {
    res.status(500).json({ error: 'Youtube Search failed' });
  }
});

app.get('/api/apple/search', async (req, res) => {
  try {
    const { query } = req.query;
    if (!appleToken) await fetchAppleToken();
    const url = `https://amp-api.music.apple.com/v1/catalog/in/search?term=${encodeURIComponent(query)}&types=songs&limit=25`;
    const response = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${appleToken}`,
        'Origin': 'https://music.apple.com'
      }
    });
    const songs = response.data.results.songs.data || [];
    const mapped = songs.map(s => ({
      id: "apple_" + s.id,
      name: s.attributes.name,
      source: "apple",
      duration: Math.floor(s.attributes.durationInMillis / 1000),
      artists: { primary: [{ name: s.attributes.artistName }] },
      image: [
        { link: s.attributes.artwork.url.replace('{w}', '100').replace('{h}', '100') },
        { link: s.attributes.artwork.url.replace('{w}', '250').replace('{h}', '250') },
        { link: s.attributes.artwork.url.replace('{w}', '500').replace('{h}', '500') }
      ]
    }));
    res.json({ data: { results: mapped } });
  } catch (err) {
    if (err.response?.status === 401) {
      appleToken = null; // Reset for retry on next request
    }
    res.status(500).json({ error: 'Apple Search failed' });
  }
});

app.get('/api/song/:id', async (req, res) => {
  try {
    const { data } = await axios.get(`${SAAVN_BASE}/songs/${req.params.id}`);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Song fetch failed' });
  }
});

app.get('/api/charts', async (req, res) => {
  try {
    const year = new Date().getFullYear();
    const queries = [
      `top hits bollywood ${year}`,
      `trending hindi songs ${year}`,
      `latest hit songs ${year}`,
      `viral hindi ${year}`
    ];

    // Fetch from multiple diverse sources to ensure it is very live
    const searchResults = await Promise.allSettled(queries.map(q => saavnSearch(q, 15)));
    const arrays = searchResults.filter(r => r.status === 'fulfilled').map(r => r.value);

    const seen = new Set();
    const merged = [];
    for (const arr of arrays) {
      for (const song of arr) {
        if (!seen.has(song.id)) {
          seen.add(song.id);
          merged.push(song);
        }
      }
    }

    // Shuffle the array so the frontend "Trending" row looks fresh on every load
    for (let i = merged.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [merged[i], merged[j]] = [merged[j], merged[i]];
    }

    res.json({ data: { results: merged.slice(0, 50) } });
  } catch (err) {
    res.status(500).json({ error: 'Charts fetch failed' });
  }
});

// ── AI Artist Fallback Resolver ──────────────────────────────────────────
app.post('/api/resolve-artist', async (req, res) => {
  try {
    const { songName } = req.body;
    if (!songName) return res.json({ artist: '' });

    const completion = await nvidia.chat.completions.create({
      model: 'meta/llama-3.1-70b-instruct',
      messages: [{
        role: 'system',
        content: `You are a music knowledge base. 
Task: Provide the name of the primary artist / singer for the given song.
Rule: Respond with ONLY the artist name(s), comma-separated if multiple. No extra text, no punctation marks, no conversational filler.
For example if song is "Tum Hi Ho", respond "Arijit Singh".`
      }, {
        role: 'user',
        content: `What is the artist of this song: "${songName}"?`
      }],
      temperature: 0.1,
      max_tokens: 20
    });

    const artistName = completion.choices[0]?.message?.content?.trim() || '';
    res.json({ artist: artistName });
  } catch (err) {
    res.status(500).json({ error: 'AI resolution failed' });
  }
});

// ── Smart AI Recommend (YouTube Music-level) ──────────────────────────────
app.post('/api/ai-smart', async (req, res) => {
  try {
    const {
      prompt = '',
      recentSongs = [],     // [{name, artistName, mood}]
      topArtists = [],      // [{name, playCount}]
      topMoods = [],        // [{mood, count}]
      sessionSongs = [],    // [{id}]
      timeContext = 'evening',
      listeningContext = '',
      songHistory = {},     // full history object for scoring
      explicitGenres = [],
      explicitArtists = [],
      userName = '',
    } = req.body;

    const sessionIds = new Set(sessionSongs.map((s) => s.id));

    // ── Build detailed user profile ──────────────────────────────────────
    const profileLines = [];

    if (topArtists.length)
      profileLines.push(
        `Top artists by plays: ${topArtists.slice(0, 6).map((a) => `${a.name}(×${a.playCount})`).join(', ')}`
      );

    if (topMoods.length)
      profileLines.push(`Mood preferences: ${topMoods.map((m) => `${m.mood}(×${m.count})`).join(', ')}`);

    if (recentSongs.length)
      profileLines.push(
        `Recently played: ${recentSongs.slice(0, 8).map((s) => `"${s.name}" by ${s.artistName}`).join(' → ')}`
      );

    // Detect skip-heavy patterns
    const skipHeavy = Object.values(songHistory)
      .filter((s) => s.skipCount > s.playCount * 0.5)
      .map((s) => s.artistName)
      .filter(Boolean)
      .slice(0, 3);
    if (skipHeavy.length)
      profileLines.push(`Avoid (high skip rate): ${[...new Set(skipHeavy)].join(', ')}`);

    const userProfileText = profileLines.length
      ? profileLines.join('\n')
      : `New user — suggest popular Indian music explicitly tailored to: ${explicitGenres.join(', ')} and ${explicitArtists.join(', ')}.`;

    const explicitPrefsText = (explicitGenres.length || explicitArtists.length)
      ? `\nCRITICAL USER ONBOARDING PREFS: The user explicitly selected these Favorite Genres: [${explicitGenres.join(', ')}] and Favorite Artists: [${explicitArtists.join(', ')}]. Highly prioritize these matches in your queries!`
      : '';

    // ── AI call ──────────────────────────────────────────────────────────
    const completion = await nvidia.chat.completions.create({
      model: 'meta/llama-3.1-70b-instruct',
      messages: [
        {
          role: 'system',
          content: `You are "Play with Debarpan" — a world-class AI music recommendation engine inspired by YouTube Music and Spotify's personalization systems, specialized in Bollywood, Hindi Indie, Punjabi, Tamil, and Global pop music available on JioSaavn.

GOAL: Generate 5 diverse but contextually perfect search queries that deliver excellent variety.

QUERY STRATEGY:
  Query 1 — DIRECT: Most relevant to request + user taste. Be specific (artist + mood + year if needed)
  Query 2 — ARTIST DISCOVERY: A similar or adjacent artist the user will love based on their history
  Query 3 — MOOD EXPANSION: Broaden to capture the vibe without being too far off
  Query 4 — GENRE DEEPDIVE: Go deeper into a genre or era they enjoy
  Query 5 — WILD CARD: A surprising but delightful recommendation outside comfort zone

TIME-OF-DAY RULES (enforce strictly):
  morning   → fresh, upbeat, motivational, energetic pop
  afternoon → focus, indie, mid-tempo, instrumental
  evening   → feel-good, classic hits, relaxed pop
  night     → romantic, emotional, slow, lofi, introspective, kafi

ARTIST SIMILARITY MAP (use this knowledge):
  Arijit Singh ↔ Jubin Nautiyal, Atif Aslam, KK, Mohit Chauhan, Armaan Malik
  Badshah ↔ Honey Singh, Diljit Dosanjh, AP Dhillon, Guru Randhawa, Nucleya
  AR Rahman ↔ Anirudh Ravichander, Harris Jayaraj, D Imman, Yuvan Shankar Raja
  Taylor Swift ↔ Olivia Rodrigo, Sabrina Carpenter, Ed Sheeran, Gracie Abrams
  Kishore Kumar ↔ Mohammed Rafi, Mukesh, Hemant Kumar
  Shreya Ghoshal ↔ Lata Mangeshkar, Sunidhi Chauhan, Neha Kakkar
  The Weeknd ↔ Post Malone, Drake, SZA, Travis Scott
  Coldplay ↔ Imagine Dragons, OneRepublic, Maroon 5

PERSONALIZATION RULES:
  - If top artist played 10+ times → always include that artist or near-similar
  - If mood is "romantic" → bias heavily toward love/romantic songs
  - NEVER repeat what's in recently played unless it's an inescapable classic
  - If skip rate is high for an artist → deprioritize them entirely
  - Respect cultural context: if user plays Punjabi → suggest more Punjabi
  - Blend old and new: if user plays Kishore Kumar, mix with Arijit Singh
  - Be SPECIFIC in queries: "Arijit Singh sad songs 2023" beats "sad songs"

Return ONLY valid JSON, no markdown, no extra text whatsoever:
{
  "searchQueries": ["query1", "query2", "query3", "query4", "query5"],
  "primaryMood": "happy|sad|romantic|energetic|chill|devotional|party|focus",
  "autoPlay": true,
  "message": "short friendly response with 1-2 emojis",
  "reasoning": "One sentence starting with 'Because' explaining the recommendation logic",
  "genre": "bollywood|punjabi|indie|global|retro|lofi"
}`,
        },
        {
          role: 'user',
          content: `User Name: ${userName || 'User'}
User request: "${prompt || 'Recommend music for me'}"
Time of day: ${timeContext}
${userProfileText}${explicitPrefsText}
${listeningContext ? `Listening context: ${listeningContext}` : ''}
${sessionSongs.length > 0 ? `Already played this session: ${sessionSongs.length} songs — avoid repeats` : ''}`,
        },
      ],
      temperature: 0.75,
      max_tokens: 500,
    });

    const raw = completion.choices[0]?.message?.content?.trim();
    let aiData;
    try {
      aiData = JSON.parse(raw);
    } catch {
      const match = raw.match(/\{[\s\S]*\}/);
      aiData = match
        ? JSON.parse(match[0])
        : {
          searchQueries: [prompt || 'top Hindi songs 2024'],
          primaryMood: 'happy',
          autoPlay: !!prompt,
          message: 'Here are some great picks for you! 🎵',
          reasoning: '',
          genre: 'bollywood',
        };
    }

    // ── Execute searches (up to 5 queries) ───────────────────────────────
    const queries = (aiData.searchQueries || [prompt || 'top hits 2024']).slice(0, 5);
    const searchResults = await Promise.allSettled(queries.map((q) => saavnSearch(q, 12)));
    const arrays = searchResults
      .filter((r) => r.status === 'fulfilled')
      .map((r) => r.value);

    const rawSongs = mergeAndDedupe(arrays, sessionIds, 30);
    // Apply skip-penalty scoring
    const songs = scoreAndSort(rawSongs, songHistory).slice(0, 25);

    res.json({
      songs,
      aiMessage: aiData.message || 'Here are your recommendations! 🎵',
      reasoning: aiData.reasoning || '',
      primaryMood: aiData.primaryMood || 'happy',
      genre: aiData.genre || 'bollywood',
      searchQueries: queries,
      autoPlay: !!aiData.autoPlay,
    });
  } catch (err) {
    console.error('AI Smart Error:', err.message);
    res.status(500).json({ error: 'AI recommendation failed.' });
  }
});

// ── Auto-Next endpoint ─────────────────────────────────────────────────────
app.post('/api/next-song', async (req, res) => {
  try {
    const {
      currentSong = {},
      topArtists = [],
      sessionSongs = [],
      timeContext = 'evening',
      mood = '',
      songHistory = {},
    } = req.body;

    const sessionIds = new Set(sessionSongs.map((s) => s.id));
    const artist = currentSong.artistName || '';
    const name = currentSong.name || '';

    // Use LLM to generate highly dynamic, contextual queries based on the song
    let aiQueries = [];
    if (name || artist) {
      try {
        const completion = await nvidia.chat.completions.create({
          model: 'meta/llama-3.1-70b-instruct',
          messages: [
            {
              role: 'system',
              content: `You are an expert music curator. The user is currently listening to "${name}" by "${artist}". 
Return exactly 4 highly contextual search queries to find the perfect next songs to play on JioSaavn.
Provide excellent variety: include 1 query for the exact same sub-genre, 1 for similar artists matching the vibe, 1 for the exact emotion/mood of the track, and 1 surprising but fitting wild card.
Do NOT just return generic "bollywood hits 2024". Be highly specific and creative.
Return ONLY valid JSON format with no markdown:
{"queries": ["query1", "query2", "query3", "query4"]}`
            }
          ],
          temperature: 0.85,
          max_tokens: 150,
        });

        const raw = completion.choices[0]?.message?.content?.trim() || '{}';
        const match = raw.match(/\{[\s\S]*\}/);
        const parsed = JSON.parse(match ? match[0] : raw);
        if (parsed.queries && Array.isArray(parsed.queries)) aiQueries = parsed.queries;
      } catch (err) {
        console.error("Next-song LLM failed, using fallback:", err.message);
      }
    }

    if (aiQueries.length === 0) {
      const similar = getSimilarArtists(artist);
      const currentMood = mood || currentSong.mood || timeContext;
      const moodQuery = MOOD_QUERIES[currentMood]?.[Math.floor(Math.random() * (MOOD_QUERIES[currentMood]?.length || 1))] || `${currentMood} hindi songs`;

      aiQueries = [
        artist ? `${artist} hits` : 'bollywood hits 2024',
        similar.length > 0 ? `${similar[0]} track` : topArtists[1]?.name ? `${topArtists[1].name} songs` : 'trending hindi',
        moodQuery,
        `${timeContext} vibes indian music`
      ];
    }

    const searchResults = await Promise.allSettled(aiQueries.map((q) => saavnSearch(q, 15)));
    const arrays = searchResults
      .filter((r) => r.status === 'fulfilled')
      .map((r) => r.value);

    const rawSongs = mergeAndDedupe(arrays, sessionIds, 30);
    const songs = scoreAndSort(rawSongs, songHistory).slice(0, 25);

    res.json({ songs, queries: aiQueries });
  } catch (err) {
    res.status(500).json({ error: 'Next song fetch failed.' });
  }
});

// ── Deep Personalized "For You" ────────────────────────────────────────────
app.post('/api/for-you', async (req, res) => {
  try {
    const {
      topArtists = [],
      topMoods = [],
      timeContext = 'evening',
      recentSongs = [],
      songHistory = {},
      explicitGenres = [],
      explicitArtists = [],
    } = req.body;

    let queries;
    const year = new Date().getFullYear();

    if (explicitArtists.length > 0 || explicitGenres.length > 0) {
      // Dynamic onboarding profile based fetching
      const topA = explicitArtists.slice(0, 3);
      const topG = explicitGenres.slice(0, 2);
      queries = [
        ...topA.map(a => `${a} best songs`),
        ...topG.map(g => `${g} hindi trending ${year}`),
        `${timeContext} vibes hindi music`,
        `trending indian music ${year}`
      ];
    } else if (topArtists.length >= 2) {
      const similar1 = getSimilarArtists(topArtists[0].name);
      const similar2 = topArtists[1] ? getSimilarArtists(topArtists[1].name) : [];
      const topMoodQuery = topMoods[0]?.mood ? MOOD_QUERIES[topMoods[0].mood]?.[0] : null;
      const timeQuery = TIME_DEFAULTS[timeContext]?.[1] || 'bollywood popular';

      queries = [
        `${topArtists[0].name} best songs`,                                                     // #1 artist
        similar1.length ? `${similar1[0]} songs` : `${topArtists[1].name} songs`,               // similar to #1
        topArtists[1] ? `${topArtists[1].name} hits` : `trending bollywood ${new Date().getFullYear()}`, // #2 artist
        similar2.length ? `${similar2[0]} songs` : topMoodQuery || timeQuery,                    // similar to #2
        topMoodQuery || timeQuery,                                                               // mood/time filler
        `trending indian music ${new Date().getFullYear()}`,                                     // freshness
      ];
    } else if (topArtists.length === 1) {
      const similar = getSimilarArtists(topArtists[0].name);
      queries = [
        `${topArtists[0].name} top songs`,
        similar[0] ? `${similar[0]} songs` : 'top hindi songs 2024',
        TIME_DEFAULTS[timeContext]?.[0] || 'feel good bollywood',
        'trending bollywood 2024',
        'popular hindi 2023 2024',
      ];
    } else {
      queries = [
        ...TIME_DEFAULTS[timeContext] || TIME_DEFAULTS.evening,
        'trending bollywood 2024',
        'best hindi songs 2024',
      ];
    }

    const searchResults = await Promise.allSettled(queries.slice(0, 5).map((q) => saavnSearch(q, 12)));
    const arrays = searchResults
      .filter((r) => r.status === 'fulfilled')
      .map((r) => r.value);

    const rawSongs = mergeAndDedupe(arrays, new Set(), 30);
    const songs = scoreAndSort(rawSongs, songHistory).slice(0, 25);

    res.json({ songs, queries: queries.slice(0, 5) });
  } catch (err) {
    res.status(500).json({ error: 'For You fetch failed.' });
  }
});

// ── Mood-based quick playlist ──────────────────────────────────────────────
app.post('/api/mood-playlist', async (req, res) => {
  try {
    const { mood = 'happy', topArtists = [], songHistory = {} } = req.body;
    const moodQs = MOOD_QUERIES[mood] || MOOD_QUERIES.happy;
    const artistBoost = topArtists[0]?.name ? `${topArtists[0].name} ${mood} songs` : null;

    const queries = artistBoost
      ? [artistBoost, ...moodQs]
      : moodQs;

    const searchResults = await Promise.allSettled(queries.slice(0, 4).map((q) => saavnSearch(q, 12)));
    const arrays = searchResults.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    const rawSongs = mergeAndDedupe(arrays, new Set(), 25);
    const songs = scoreAndSort(rawSongs, songHistory).slice(0, 20);

    res.json({ songs, mood });
  } catch (err) {
    res.status(500).json({ error: 'Mood playlist failed.' });
  }
});


// ── Lyrics ─────────────────────────────────────────────────────────────────
app.get('/api/lyrics/:id', async (req, res) => {
  // 1. Try JioSaavn first
  try {
    const r = await axios.get(`${SAAVN_BASE}/lyrics?id=${req.params.id}`, { timeout: 4000 });
    if (r.data?.data?.lyrics) {
      return res.json(r.data);
    }
  } catch (e) { }

  // 2. Fallback to LRCLIB (Massive crowdsourced Spotify/Apple Music synced lyrics DB)
  try {
    const { t, a } = req.query;
    if (t) {
      const query = `${t} ${a || ''}`.trim();
      const lrcRes = await axios.get(`https://lrclib.net/api/search?q=${encodeURIComponent(query)}`, { timeout: 5000 });
      if (lrcRes.data && lrcRes.data.length > 0) {
        // Prefer synced lyrics over plain
        const bestMatch = lrcRes.data.find(x => x.syncedLyrics) || lrcRes.data[0];
        const lyrics = bestMatch.syncedLyrics || bestMatch.plainLyrics;
        if (lyrics) {
          return res.json({ status: 'success', data: { lyrics } });
        }
      }
    }
  } catch (e) { }

  res.status(404).json({ status: 'not_found', data: null });
});

// ── AI Transliterate (Hindi / Devanagari → English pronunciation) ──────────
app.post('/api/transliterate', async (req, res) => {
  try {
    const { lines = [] } = req.body;
    if (!lines.length) return res.json({ romanized: [] });

    const completion = await nvidia.chat.completions.create({
      model: 'meta/llama-3.1-70b-instruct',
      messages: [
        {
          role: 'system',
          content: `You are a Hindi/Urdu romanization expert. Transliterate each input line to English pronunciation (Roman script).
Rules:
- Convert Devanagari sounds to English letters (e.g. "तुम" → "tum", "प्यार" → "pyaar", "दिल" → "dil", "मैं" → "main")
- Keep lines that are already in English unchanged
- Return EXACTLY the same number of lines as input
- Return ONLY the romanized text, one line per input line, no explanations, no numbering`,
        },
        { role: 'user', content: lines.join('\n') },
      ],
      temperature: 0.1,
      max_tokens: 800,
    });

    const raw = completion.choices[0]?.message?.content?.trim() || '';
    const romanized = raw.split('\n').map((l) => l.trim());
    while (romanized.length < lines.length) romanized.push('');
    res.json({ romanized: romanized.slice(0, lines.length) });
  } catch (err) {
    console.error('Transliterate error:', err.message);
    res.status(500).json({ romanized: [] });
  }
});

// Run locally if not in production, otherwise export for Vercel Serverless
if (process.env.NODE_ENV !== 'production') {
  app.listen(5000, () => console.log('🎵 Play with Debarpan — Server running on port 5000'));
}

module.exports = app;
