
const axios = require('axios');

const artists = [
  'Arijit Singh',
  'Badshah',
  'Shreya Ghoshal',
  'Diljit Dosanjh',
  'AP Dhillon',
  'AR Rahman',
  'Pritam',
  'Taylor Swift',
  'Kishore Kumar',
  'Ed Sheeran'
];

async function updateArtists() {
  const SAAVN_BASE = 'https://jiosaavn-api-privatecvc2.vercel.app';
  const results = [];

  for (const name of artists) {
    try {
      const res = await axios.get(`${SAAVN_BASE}/search/artists?query=${encodeURIComponent(name)}&limit=1`);
      const artistData = res.data?.data?.results?.[0];
      if (artistData) {
        let img = '';
        if (artistData.image && artistData.image.length > 0) {
          // Use 150x150 or similar quality link
          const imgObj = artistData.image.find(i => i.quality === '150x150') || artistData.image[artistData.image.length - 1];
          img = imgObj.link;
        }
        results.push({ name, img });
      } else {
        results.push({ name, img: '' });
      }
    } catch (e) {
      console.error(`Failed to fetch ${name}`, e.message);
      results.push({ name, img: '' });
    }
  }

  console.log(JSON.stringify(results, null, 2));
}

updateArtists();
