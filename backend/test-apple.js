const axios = require('axios');

async function getToken() {
    const mainPageURL = 'https://beta.music.apple.com';
    const mainPageResponse = await axios.get(mainPageURL);
    const mainPageBody = mainPageResponse.data;

    const jsFileRegex = /\/assets\/[^"'>]+\.js/g;
    const jsFiles = mainPageBody.match(jsFileRegex) || [];
    
    console.log("Found JS files:", jsFiles);

    for (const uri of jsFiles) {
        if (!uri.includes('index-')) continue;
        try {
            const res = await axios.get(mainPageURL + uri);
            const tokenRegex = /"?(eyJh[^"]+)"?/;
            const match = res.data.match(tokenRegex);
            if (match && match[1]) {
                return match[1];
            }
        } catch(e) {}
    }
    throw new Error('Token not found in any JS file');
}

async function test() {
  try {
    console.log("Fetching Apple Token...");
    const token = await getToken();
    console.log("Token:", token.substring(0, 30) + '...');
    
    console.log("Searching for 'Shape of You'...");
    const url = `https://amp-api.music.apple.com/v1/catalog/in/search?term=Shape%20of%20You&types=songs&limit=5`;
    const res = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Origin': 'https://music.apple.com'
      }
    });
    
    const songs = res.data.results.songs.data;
    console.log("Top Hit:", songs[0].attributes.name, "by", songs[0].attributes.artistName);
    console.log("SUCCESS!");
  } catch(e) {
    console.error("FAIL:", e.response?.data || e.message);
  }
}
test();
