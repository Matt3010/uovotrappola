const SpotifyWebApi = require('spotify-web-api-node');
const dotenv = require('dotenv');
const readline = require('readline');

dotenv.config();

const spotifyApi = new SpotifyWebApi({
    clientId: process.env.CX_SPOTIFY_CLIENT_ID,
    clientSecret: process.env.CX_SPOTIFY_CLIENT_SECRET,
    redirectUri: 'http://127.0.0.1:8888/callback'
});

// Questi permessi permettono al bot di modificare le tue playlist
const scopes = ['playlist-modify-public', 'playlist-modify-private'];

const authorizeURL = spotifyApi.createAuthorizeURL(scopes);

console.log('\n--- GENERATORE TOKEN SPOTIFY ---');
console.log('1. Assicurati che "http://localhost:8888/callback" sia nei Redirect URIs della tua app Spotify.');
console.log('2. Apri questo link nel browser e fai il login:');
console.log('\n' + authorizeURL + '\n');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

rl.question('3. Incolla qui il codice che trovi nella barra degli indirizzi dopo "?code=": ', (code) => {
    spotifyApi.authorizationCodeGrant(code).then(
        function(data) {
            console.log('\n✅ SUCCESSO! Copia questa riga nel tuo file .env:');
            console.log(`CX_SPOTIFY_REFRESH_TOKEN=${data.body['refresh_token']}`);
            process.exit();
        },
        function(err) {
            console.error('\n❌ Errore durante l\'autenticazione:', err);
            process.exit();
        }
    );
});