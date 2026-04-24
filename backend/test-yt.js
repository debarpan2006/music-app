const YTMusic = require('ytmusic-api');
const ytdl = require('@distube/ytdl-core');

async function test() {
  try {
    const ytmusic = new YTMusic.default();
    await ytmusic.initialize();
    
    console.log("Searching for 'Tum Hi Ho'...");
    const songs = await ytmusic.searchSongs("Tum Hi Ho");
    const topSong = songs[0];
    
    console.log("Top Result:", topSong.name, "by", topSong.artists?.map(a => a.name).join(', '));
    console.log("Video ID:", topSong.videoId);
    
    const info = await ytdl.getInfo(topSong.videoId);
    const format = ytdl.chooseFormat(info.formats, { quality: 'highestaudio' });
    
    console.log("Direct Audio Stream URL:", format.url.substring(0, 50) + "...");
    console.log("SUCCESS!");
  } catch (err) {
    console.error("Test failed:", err.message);
  }
}

test();
