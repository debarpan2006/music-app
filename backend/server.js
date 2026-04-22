const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const SAAVN_BASE = 'https://saavn.dev/api';

// Search Songs
app.get('/api/search', async (req, res) => {
  try {
    const { query } = req.query;
    const { data } = await axios.get(
      `${SAAVN_BASE}/search/songs?query=${query}&limit=20`
    );
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Search failed' });
  }
});

// Get Song by ID
app.get('/api/song/:id', async (req, res) => {
  try {
    const { data } = await axios.get(
      `${SAAVN_BASE}/songs/${req.params.id}`
    );
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Song fetch failed' });
  }
});

// Get Top Charts / Featured
app.get('/api/charts', async (req, res) => {
  try {
    const { data } = await axios.get(`${SAAVN_BASE}/search/songs?query=top+hits+2024&limit=20`);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Charts fetch failed' });
  }
});

app.listen(5000, () => console.log('Server running on port 5000'));
