# Jukebox

Jukebox is a tool used to efficiently control audio. You can add songs from your local machine or from youtube (for youtube, see Automatically Downloading from Youtube)

It is a tool designed for DMing D&D/TTRPG sessions.

# Uploading Audios
In the "Manage Songs" tab, press 'Upload Song' and follow the instructions to upload a song from your local machine.  

Downloading videos from youtube isn't possible without some setup due to youtube restrictions - see "Automatically Downloading from Youtube" below.

# Sound Effects
Select a region in the song player by dragging the right mouse button over the progress bar. You can apply sound effects by right clicking on the selected region.

# Automatically downloading from youtube

Youtube doesn't allow public hosting for services like this, so it's necessary to locally run the code. To use this feature, you must:
1. Clone this repository with <a href='https://git-scm.com/downloads'> git<a/> and manually host the website on your machine (do not use an external server, VPN or proxy)
2. Install the following <a href='https://nodejs.org/en/download'> node<a/> modules:
```bash
npm install cors yt-dlp-exec express
```

Clone the <a href='https://github.com/ilvro/jukebox-backend'> backend<a/>, navigate to the directory and run the code on the terminal with `node server.js`

The terminal should show `Server is running on port 3000`. 

This should allow you to paste any youtube URL into `Paste a youtube link here...` in the Upload tab to automatically download audios.
# Integração com a mesa (Atlas e companhia)
O Jukebox fala o contrato da mesa (`mesa.json`, `mesa.js`, `vendor/mesa-core/`; o contrato está descrito em `Atlas/docs/PLATAFORMA.md`). Abertos no mesmo navegador e na mesma origem:
- as **cenas** e as faixas com o gênero **sfx** (os efeitos avulsos) viram entidades da campanha ativa (`mesa:campanha-ativa`), para o Atlas escolher;
- `jukebox.tocar` ativa uma cena pelo pedido de outro aplicativo (por exemplo, quando o clima do mapa muda), e `jukebox.efeito` toca uma faixa sfx uma vez, por cima da música;
- `jukebox.tocando` avisa qual cena está ativa (ou nenhuma).
Sem `BroadcastChannel` ou `IndexedDB`, o Jukebox funciona como antes. `vendor/mesa-core/` é uma cópia fixa do `mesa-core` compilado do Atlas (`npm run build:core`).
