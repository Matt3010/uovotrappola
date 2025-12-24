const TelegramBot = require("node-telegram-bot-api");
const { google } = require("googleapis");
const SpotifyWebApi = require("spotify-web-api-node");
const dotenv = require("dotenv");
const crypto = require("crypto");
const sqlite3 = require("sqlite3").verbose(); // Modulo Database

dotenv.config();

// Configurazione Bot Telegram
const bot = new TelegramBot(process.env.TG_BOT_TOKEN, { polling: true });
const allowedGroupId = parseInt(process.env.TG_ALLOWED_GROUP_ID);

// ID Playlist
const ytPlaylistId = process.env.YT_PLAYLIST_ID;
const spPlaylistId = process.env.CX_SPOTIFY_PLAYLIST_ID;

// ---------------- DATABASE SETUP (SQLite) ----------------
const db = new sqlite3.Database('./trappola.db', (err) => {
  if (err) console.error("❌ Errore apertura DB, la madama ci ha bloccato:", err.message);
  else console.log("💾 Bando digitale connesso. Database operativo.");
});

// Creazione Tabella Utenti se non esiste
db.run(`CREATE TABLE IF NOT EXISTS users (
                                           id INTEGER PRIMARY KEY,
                                           username TEXT,
                                           points INTEGER DEFAULT 0,
                                           songs_added INTEGER DEFAULT 0,
                                           songs_rejected INTEGER DEFAULT 0
        )`);

// Funzioni Helper Database
function updateUserScore(userId, username, pointsDelta, isWin) {
  db.serialize(() => {
    // Inserisci utente se non esiste
    db.run(`INSERT OR IGNORE INTO users (id, username) VALUES (?, ?)`, [userId, username]);

    // Aggiorna username (magari ha cambiato nome da snitch a boss)
    db.run(`UPDATE users SET username = ? WHERE id = ?`, [username, userId]);

    // Aggiorna rispetto (punti)
    const fieldToIncrement = isWin ? 'songs_added' : 'songs_rejected';
    db.run(`UPDATE users SET points = points + ?, ${fieldToIncrement} = ${fieldToIncrement} + 1 WHERE id = ?`,
        [pointsDelta, userId],
        function(err) {
          if (err) console.error("Errore aggiornamento respect:", err);
        }
    );
  });
}

function getRankTitle(points) {
  if (points < 0) return "🐀 Snitch (Infame)";
  if (points < 50) return "👶 Pischello Dark";
  if (points < 150) return "🥤 DPG Member";
  if (points < 300) return "💸 Capo Plaza";
  if (points < 600) return "👑 King del Bando";
  return "👽 Alieno (Sfera Tier)";
}

// Funzione Helper per mostrare la classifica (usata da /top e dopo vittoria sondaggio)
function showLeaderboard(chatId) {
  db.all(`SELECT username, points FROM users ORDER BY points DESC LIMIT 10`, [], (err, rows) => {
    if (err) return bot.sendMessage(chatId, "❌ Errore nel database. Qualcuno ha fatto la spia.");

    if (rows.length === 0) return bot.sendMessage(chatId, "📭 Il bando è vuoto. Nessuno sta fatturando.");

    let message = "🏆 **CLASSIFICA ZONA** 🏆\n_Chi sta facendo i veri numeri:_\n\n";
    rows.forEach((row, index) => {
      const medal = index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : "🔹";
      message += `${medal} **${row.username}**: ${row.points} respect\n`;
    });

    bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
  });
}

// ---------------- YOUTUBE SETUP ----------------
const oauth2Client = new google.auth.OAuth2(
    process.env.YT_OAUTH_CLIENT_ID,
    process.env.YT_OAUTH_CLIENT_SECRET,
    "urn:ietf:wg:oauth:2.0:oob"
);

oauth2Client.setCredentials({
  refresh_token: process.env.YT_REFRESH_TOKEN
});

const youtube = google.youtube({
  version: "v3",
  auth: oauth2Client
});

// ---------------- SPOTIFY SETUP ----------------
const spotifyApi = new SpotifyWebApi({
  clientId: process.env.CX_SPOTIFY_CLIENT_ID,
  clientSecret: process.env.CX_SPOTIFY_CLIENT_SECRET,
  refreshToken: process.env.CX_SPOTIFY_REFRESH_TOKEN
});

async function refreshSpotifyToken() {
  try {
    const data = await spotifyApi.refreshAccessToken();
    spotifyApi.setAccessToken(data.body['access_token']);
    console.log("🔄 Token Spotify rinnovato. Si vola.");
  } catch (err) {
    console.error('❌ Errore rinnovo token Spotify. Che pacco:', err);
  }
}

refreshSpotifyToken();
setInterval(refreshSpotifyToken, 1000 * 60 * 50);

// ---------------- GESTIONE SONDAGGI E RICERCHE ----------------
const activePolls = new Map();
const searchCache = new Map();

// ---------------- COMANDO /song ----------------
bot.onText(/\/song (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;

  if (chatId !== allowedGroupId) {
    console.log(`Tentativo accesso da chat non autorizzata: ${chatId}. Chiama la security.`);
    return;
  }

  const query = match[1].trim();
  if (!query || query.length < 2) {
    return bot.sendMessage(chatId, "⚠️ Scrivi un titolo serio dopo /song, non farmi perdere tempo.");
  }

  try {
    const [ytResults, spResults] = await Promise.all([
      searchYouTube(query, 5),
      searchSpotify(query, 5)
    ]);

    if ((!ytResults || ytResults.length === 0) && (!spResults || spResults.length === 0)) {
      return bot.sendMessage(chatId, "❌ Non ho trovato niente frate. Cambia spacciatore.");
    }

    const requestId = crypto.randomBytes(4).toString("hex");
    searchCache.set(requestId, { ytResults, spResults });
    setTimeout(() => searchCache.delete(requestId), 5 * 60 * 1000);

    const keyboard = [];

    if (spResults && spResults.length > 0) {
      keyboard.push([{ text: "🟢 --- ROBA DA SPOTIFY ---", callback_data: "NOOP" }]);
      spResults.forEach((track, index) => {
        keyboard.push([{
          text: `🎵 ${track.artist} - ${track.title}`,
          callback_data: `SEL:SP:${requestId}:${index}`
        }]);
      });
    }

    if (ytResults && ytResults.length > 0) {
      keyboard.push([{ text: "📹 --- ROBA DA YOUTUBE ---", callback_data: "NOOP" }]);
      ytResults.forEach((video, index) => {
        keyboard.push([{
          text: `📹 ${video.title}`,
          callback_data: `SEL:YT:${requestId}:${index}`
        }]);
      });
    }

    keyboard.push([{ text: "❌ Annulla (Pacco)", callback_data: `CANCEL:${requestId}` }]);

    await bot.sendMessage(chatId, `🔍 **Ho trovato questo stuff per:** _${query}_\nDimmi qual è la traccia vera prima che arrivi la madama:`, {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: keyboard }
    });

  } catch (error) {
    console.error("Errore generale /song:", error);
    bot.sendMessage(chatId, "❌ Crash del sistema. Troppi drip, server in tilt.");
  }
});

// ---------------- NUOVI COMANDI GAMIFICATION ----------------

// Comando /top - Classifica
bot.onText(/\/top/, (msg) => {
  if (msg.chat.id !== allowedGroupId) return;
  showLeaderboard(msg.chat.id);
});

// Comando /stats - Statistiche Personali
bot.onText(/\/stats/, (msg) => {
  if (msg.chat.id !== allowedGroupId) return;
  const userId = msg.from.id;

  db.get(`SELECT * FROM users WHERE id = ?`, [userId], (err, row) => {
    if (err) return bot.sendMessage(msg.chat.id, "❌ Errore database.");

    if (!row) return bot.sendMessage(msg.chat.id, "⚠️ Non hai ancora droppato nulla. Sei un fantasma.");

    const rank = getRankTitle(row.points);
    const total = row.songs_added + row.songs_rejected;
    const winRate = total > 0 ? Math.round((row.songs_added / total) * 100) : 0;

    let message = `📊 **FEDINA PENALE DI ${row.username}**\n\n`;
    message += `🏷️ **Grado:** ${rank}\n`;
    message += `💎 **Respect:** ${row.points}\n`;
    message += `✅ **Hit Entrate:** ${row.songs_added}\n`;
    message += `❌ **Flop Rifiutati:** ${row.songs_rejected}\n`;
    message += `📈 **Credibilità di strada:** ${winRate}%`;

    bot.sendMessage(msg.chat.id, message, { parse_mode: "Markdown" });
  });
});

// Comando /playlists - Ottieni i link
bot.onText(/\/playlists/, (msg) => {
  if (msg.chat.id !== allowedGroupId) return;

  const ytUrl = `https://www.youtube.com/playlist?list=${ytPlaylistId}`;
  const spUrl = `https://open.spotify.com/playlist/${spPlaylistId}`;

  const message = `💿 **ARCHIVIO DEL BANDO**\n_Ecco dove teniamo la roba:_\n\n` +
      `📹 **YouTube:** [Guarda il video-bando](${ytUrl})\n` +
      `🟢 **Spotify:** [Ascolta lo stream](${spUrl})\n\n` +
      `_Pompa il volume e non fare domande._`;

  bot.sendMessage(msg.chat.id, message, { parse_mode: "Markdown", disable_web_page_preview: true });
});

// Comando /help - Lista Comandi
bot.onText(/\/help/, (msg) => {
  if (msg.chat.id !== allowedGroupId) return;

  const message = `📚 **IL CODICE DELLA STRADA**\n\n` +
      `/song [titolo] - Droppa una hit nel bando\n` +
      `/playlists - I link per ascoltare la roba\n` +
      `/top - Vedi chi comanda la zona\n` +
      `/stats - Controlla la tua fedina penale\n` +
      `/help - Leggi le regole, snitch`;

  bot.sendMessage(msg.chat.id, message, { parse_mode: "Markdown" });
});

// ---------------- GESTIONE CLICK PULSANTI ----------------
bot.on("callback_query", async (callbackQuery) => {
  const msg = callbackQuery.message;
  const chatId = msg.chat.id;
  const data = callbackQuery.data;
  const userId = callbackQuery.from.id;
  const username = callbackQuery.from.username ? `@${callbackQuery.from.username}` : callbackQuery.from.first_name;

  if (data.startsWith("CANCEL")) {
    await bot.deleteMessage(chatId, msg.message_id);
    return bot.answerCallbackQuery(callbackQuery.id, { text: "Operazione annullata. Nessuno ha visto niente." });
  }

  if (data === "NOOP") return bot.answerCallbackQuery(callbackQuery.id);

  if (data.startsWith("SEL:")) {
    const parts = data.split(":");
    const type = parts[1];
    const requestId = parts[2];
    const index = parseInt(parts[3]);

    const cached = searchCache.get(requestId);
    if (!cached) {
      return bot.answerCallbackQuery(callbackQuery.id, { text: "❌ Troppo lento frate. Riprova /song", show_alert: true });
    }

    let selectedYt = null;
    let selectedSp = null;
    let pollTitle = "";

    try {
      await bot.editMessageText(`🔄 ${username} sta cucinando...`, { chat_id: chatId, message_id: msg.message_id });

      if (type === "SP") {
        selectedSp = cached.spResults[index];
        const searchString = `${selectedSp.artist} ${selectedSp.title}`;
        pollTitle = `${selectedSp.artist} - ${selectedSp.title}`;
        const ytMatches = await searchYouTube(searchString, 1);
        if (ytMatches && ytMatches.length > 0) selectedYt = ytMatches[0];

      } else if (type === "YT") {
        selectedYt = cached.ytResults[index];
        const cleanTitle = selectedYt.title.replace(/(\(|\[).*?(\)|\])/g, "").trim();
        pollTitle = selectedYt.title;
        const spMatches = await searchSpotify(cleanTitle, 1);
        if (spMatches && spMatches.length > 0) selectedSp = spMatches[0];
      }

      await bot.deleteMessage(chatId, msg.message_id);

      // Passiamo userId e username
      await createPoll(chatId, userId, username, selectedYt, selectedSp, pollTitle);

      searchCache.delete(requestId);

    } catch (e) {
      console.error("Errore processamento selezione:", e);
      bot.sendMessage(chatId, "❌ Errore nel mixaggio. Riprova.");
    }
  }
});

// ---------------- CREAZIONE SONDAGGIO ----------------
async function createPoll(chatId, proposerId, proposerName, ytResult, spResult, displayTitle) {
  let coverUrl = null;

  if (spResult && spResult.uri) {
    try {
      const trackId = spResult.uri.split(':')[2];
      const trackData = await spotifyApi.getTrack(trackId);
      if (trackData.body.album.images && trackData.body.album.images.length > 0) {
        coverUrl = trackData.body.album.images[0].url;
      }
    } catch (e) { console.error("⚠️ No cover Spotify:", e.message); }
  }

  if (!coverUrl && ytResult) {
    coverUrl = `https://img.youtube.com/vi/${ytResult.id}/hqdefault.jpg`;
  }

  let caption = `💊 **Nuova dose da:** ${proposerName}\n`;
  caption += `🎵 **Traccia:** ${displayTitle}\n\n`;
  caption += ytResult ? `📹 [YouTube Plug](https://youtu.be/${ytResult.id})\n` : `📹 **YouTube:** ❌ Pacco (Non trovato)\n`;

  if (spResult) {
    const trackId = spResult.uri.split(':')[2];
    caption += `🟢 [Spotify Gang](http://open.spotify.com/track/${trackId})\n`;
  } else {
    caption += `🟢 **Spotify:** ❌ Pacco (Non trovato)\n`;
  }

  let recapMsg;
  try {
    if (coverUrl) {
      recapMsg = await bot.sendPhoto(chatId, coverUrl, { caption: caption, parse_mode: "Markdown" });
    } else {
      recapMsg = await bot.sendMessage(chatId, caption, { parse_mode: "Markdown", disable_web_page_preview: false });
    }
  } catch (e) {
    recapMsg = await bot.sendMessage(chatId, caption, { parse_mode: "Markdown" });
  }

  const members = await bot.getChatMemberCount(chatId);
  const requiredVotes = Math.max(1, Math.ceil(members / 2));

  const pollMsg = await bot.sendPoll(
      chatId,
      `È GHIACCIO O È PACCO? 🥶`,
      ["🔥 HIT (GHIACCIO)", "🗑️ FLOP (MONNEZZA)"],
      { is_anonymous: false, allows_multiple_answers: false, reply_to_message_id: recapMsg.message_id }
  );

  activePolls.set(pollMsg.poll.id, {
    chatId,
    proposerId,
    proposerName,
    ytVideoId: ytResult ? ytResult.id : null,
    spTrackUri: spResult ? spResult.uri : null,
    yes: 0,
    no: 0,
    requiredVotes,
    messageId: pollMsg.message_id
  });
}

// ---------------- GESTIONE VOTI E AGGIORNAMENTO DB ----------------
bot.on("poll_answer", async (answer) => {
  const pollId = answer.poll_id;
  const poll = activePolls.get(pollId);

  if (!poll) return;

  const voteIndex = answer.option_ids[0];
  if (voteIndex === 0) poll.yes++;
  if (voteIndex === 1) poll.no++;

  if (poll.yes >= poll.requiredVotes || poll.no >= poll.requiredVotes) {
    try {
      await bot.stopPoll(poll.chatId, poll.messageId);
    } catch (e) { console.error("Errore stopPoll:", e.message); }

    if (poll.yes >= poll.requiredVotes) {
      // VITTORIA: Aggiorna DB (+10 punti)
      updateUserScore(poll.proposerId, poll.proposerName, 10, true);

      await bot.sendMessage(poll.chatId, `❄️ **È GHIACCIO!** La Gang approva. (+10 respect a ${poll.proposerName})`, { parse_mode: "Markdown" });

      let report = "";
      // Logica inserimento playlist
      if (poll.ytVideoId) {
        try {
          await addYoutube(poll.ytVideoId);
          report += "📹 YouTube: **Nel Bando** ✅\n";
        } catch (e) {
          report += e.message.includes("Presente") ? "📹 YouTube: ⚠️ Già droppata frate\n" : "📹 YouTube: ❌ Glitch del sistema\n";
        }
      } else { report += "📹 YouTube: ⏭️ Skippato\n"; }

      if (poll.spTrackUri) {
        try {
          await addSpotify(poll.spTrackUri);
          report += "🟢 Spotify: **In Playlist** ✅\n";
        } catch (e) { report += "🟢 Spotify: ❌ Errore server\n"; }
      } else { report += "🟢 Spotify: ⏭️ Skippato\n"; }

      await bot.sendMessage(poll.chatId, report, { parse_mode: "Markdown" });

      // Mostra classifica automaticamente dopo vittoria
      setTimeout(() => showLeaderboard(poll.chatId), 1000);

    } else {
      // SCONFITTA: Aggiorna DB (-2 punti)
      updateUserScore(poll.proposerId, poll.proposerName, -2, false);
      await bot.sendMessage(poll.chatId, `🧱 **NON CAPTA.** Sei un bufu. (-2 respect a ${poll.proposerName})`, { parse_mode: "Markdown" });
    }

    activePolls.delete(pollId);
  }
});

// ---------------- HELPER FUNCTIONS ----------------

async function searchYouTube(query, limit = 1) {
  try {
    const res = await youtube.search.list({
      part: ["snippet"],
      q: query,
      maxResults: limit,
      type: "video"
    });
    if (res.data.items && res.data.items.length > 0) {
      return res.data.items.map(item => ({
        id: item.id.videoId,
        title: item.snippet.title
      }));
    }
    return [];
  } catch (e) {
    console.error("YT Search Error:", e.message);
    return [];
  }
}

async function searchSpotify(query, limit = 1) {
  try {
    const res = await spotifyApi.searchTracks(query, { limit: limit });
    if (res.body.tracks.items.length > 0) {
      return res.body.tracks.items.map(track => {
        return {
          uri: track.uri,
          title: track.name,
          artist: track.artists[0].name
        };
      });
    }
    return [];
  } catch (e) {
    console.error("Spotify Search Error:", e.message);
    await refreshSpotifyToken();
    return [];
  }
}

async function addYoutube(videoId) {
  const isPresent = await isVideoInYtPlaylist(videoId);
  if (isPresent) throw new Error("Presente");

  await youtube.playlistItems.insert({
    part: ["snippet"],
    requestBody: {
      snippet: {
        playlistId: ytPlaylistId,
        resourceId: { kind: "youtube#video", videoId }
      }
    }
  });
}

async function addSpotify(trackUri) {
  await spotifyApi.addTracksToPlaylist(spPlaylistId, [trackUri]);
}

async function isVideoInYtPlaylist(videoId) {
  let nextPageToken = null;
  do {
    const res = await youtube.playlistItems.list({
      part: ["snippet"],
      playlistId: ytPlaylistId,
      maxResults: 50,
      pageToken: nextPageToken || undefined
    });

    const items = res.data.items || [];
    for (const item of items) {
      if (item.snippet.resourceId.videoId === videoId) return true;
    }
    nextPageToken = res.data.nextPageToken;
  } while (nextPageToken);

  return false;
}