(function(global){
  const API_SRC = "https://www.youtube.com/iframe_api";
  const PLAYER_VARS = { playsinline: 1, modestbranding: 1, rel: 0, controls: 0, enablejsapi: 1, origin: window.location.origin };
  let apiPromise = null;
  const activePlayers = new Set();

  function loadApi(){
    if(global.loadYouTubeApi) return global.loadYouTubeApi();
    if(global.YT?.Player) return Promise.resolve(global.YT);
    if(apiPromise) return apiPromise;
    apiPromise = new Promise((resolve, reject)=>{
      const prev = global.onYouTubeIframeAPIReady;
      global.onYouTubeIframeAPIReady = () => { prev?.(); resolve(global.YT); };
      const existingScript = document.querySelector(`script[src="${API_SRC}"]`);
      if(existingScript) return;
      const script = document.createElement('script');
      script.src = API_SRC;
      script.async = true;
      script.onerror = () => reject(new Error('yt-api-load-failure'));
      document.head.appendChild(script);
    });
    return apiPromise;
  }

  function extractVideoId(input){
    if(!input) return null;
    const v = String(input).trim();
    if(/^[A-Za-z0-9_-]{6,}$/.test(v)) return v;
    const m = v.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/i);
    return m ? m[1] : null;
  }

  function pauseOtherPlayers(current){
    activePlayers.forEach(player=>{ if(player !== current) player.pauseVideo?.(); });
  }

  class YouTubeEmbed {
    constructor(el, opts={}){
      this.el = el;
      this.opts = opts;
      this.videoId = extractVideoId(opts.videoId || opts.url);
      this.player = null;
      this.state = { playing:false, muted:false, volume:100, time:0, duration:0, qualities:[], speeds:[] };
      this.progressTimer = null;
      this.intersectionObserver = null;
      this.booted = false;
      this.buildShell();
      this.observe();
    }

    buildShell(){
      this.el.classList.add('ytEmbed');
      this.el.innerHTML = `
        <div class="ytEmbedAspect">
          <button class="ytEmbedPoster" type="button" aria-label="Play video"></button>
          <div class="ytEmbedPlayer" hidden></div>
          <div class="ytEmbedError" hidden><p>Video unavailable.</p><button type="button" class="ytRetry">Retry</button></div>
          <div class="ytEmbedControls">
            <button type="button" class="ytPlay">▶</button><input class="ytSeek" type="range" min="0" max="0" value="0" />
            <span class="ytTime">0:00 / 0:00</span><button type="button" class="ytMute">🔊</button><input class="ytVolume" type="range" min="0" max="100" value="100" />
            <button type="button" class="ytFs">⛶</button><details class="ytMore"><summary>⋯</summary><div class="ytSecondary"><select class="ytSpeed"></select><select class="ytQuality"></select><a class="ytOpen" target="_blank" rel="noopener">YouTube</a></div></details>
          </div>
        </div>`;
      this.poster = this.el.querySelector('.ytEmbedPoster');
      this.playerHost = this.el.querySelector('.ytEmbedPlayer');
      this.err = this.el.querySelector('.ytEmbedError');
      this.playBtn = this.el.querySelector('.ytPlay');
      this.seek = this.el.querySelector('.ytSeek');
      this.time = this.el.querySelector('.ytTime');
      this.muteBtn = this.el.querySelector('.ytMute');
      this.volume = this.el.querySelector('.ytVolume');
      this.fs = this.el.querySelector('.ytFs');
      this.speed = this.el.querySelector('.ytSpeed');
      this.quality = this.el.querySelector('.ytQuality');
      this.open = this.el.querySelector('.ytOpen');
      this.open.href = this.videoId ? `https://www.youtube.com/watch?v=${this.videoId}` : '#';
      if(this.videoId) this.poster.style.backgroundImage = `url(https://i.ytimg.com/vi/${this.videoId}/hqdefault.jpg)`;
      this.poster.addEventListener('click', ()=>this.initPlayer(true));
      this.el.querySelector('.ytRetry').addEventListener('click', ()=>this.initPlayer(false, true));
      this.playBtn.addEventListener('click', ()=>this.togglePlay());
      this.seek.addEventListener('input', ()=>this.player?.seekTo(Number(this.seek.value), true));
      this.volume.addEventListener('input', ()=>{ this.player?.setVolume(Number(this.volume.value)); this.player?.unMute?.(); this.sync(); });
      this.muteBtn.addEventListener('click', ()=>{ if(this.player?.isMuted?.()) this.player.unMute(); else this.player?.mute(); this.sync(); });
      this.fs.addEventListener('click', ()=> this.el.querySelector('.ytEmbedAspect').requestFullscreen?.());
      this.speed.addEventListener('change', ()=> this.player?.setPlaybackRate?.(Number(this.speed.value)));
      this.quality.addEventListener('change', ()=> this.player?.setPlaybackQuality?.(this.quality.value));
    }
    observe(){
      this.intersectionObserver = new IntersectionObserver(entries=>{
        entries.forEach(entry=>{ if(entry.isIntersecting && !this.booted) this.initPlayer(false); });
      }, { rootMargin: '180px' });
      this.intersectionObserver.observe(this.el);
    }
    async initPlayer(autoplay=false, force=false){
      if(!this.videoId){ this.showError('Invalid YouTube URL'); return; }
      if(this.player && !force){ if(autoplay) this.player.playVideo?.(); return; }
      this.poster.hidden = true; this.playerHost.hidden = false; this.err.hidden = true;
      try{
        const YT = await loadApi();
        this.booted = true;
        this.player = new YT.Player(this.playerHost, { videoId:this.videoId, playerVars: PLAYER_VARS, events:{ onReady:()=>{ if(autoplay) this.player.playVideo?.(); this.populateSelectors(); this.sync(); }, onStateChange:(e)=>{ if(e.data===YT.PlayerState.PLAYING) pauseOtherPlayers(this.player); this.sync(); }, onError:()=> this.showError('Video unavailable') } });
        activePlayers.add(this.player);
      }catch{ this.showError('Failed to load YouTube API'); }
    }
    populateSelectors(){
      const speeds = this.player?.getAvailablePlaybackRates?.() || [1];
      this.speed.innerHTML = speeds.map(v=>`<option value="${v}">${v}x</option>`).join('');
      const q = this.player?.getAvailableQualityLevels?.() || [];
      if(q.length){ this.quality.innerHTML = q.map(v=>`<option value="${v}">${v}</option>`).join(''); }
      else { this.quality.innerHTML = '<option value="default">Auto</option>'; }
    }
    togglePlay(){
      const s = this.player?.getPlayerState?.();
      if(s === global.YT?.PlayerState?.PLAYING) this.player.pauseVideo?.(); else this.player.playVideo?.();
    }
    sync(){
      clearTimeout(this.progressTimer);
      const run = ()=>{ if(!this.player) return; const d = Number(this.player.getDuration?.()||0), t=Number(this.player.getCurrentTime?.()||0); this.seek.max = d; this.seek.value=t; this.time.textContent=`${fmt(t)} / ${fmt(d)}`; this.playBtn.textContent = this.player.getPlayerState?.()===global.YT?.PlayerState?.PLAYING ? '❚❚' : '▶'; this.muteBtn.textContent = this.player.isMuted?.() ? '🔇':'🔊'; this.progressTimer = setTimeout(run, 250); };
      run();
    }
    showError(msg){ this.err.hidden = false; this.err.querySelector('p').textContent = msg; this.poster.hidden = false; this.playerHost.hidden = true; }
  }

  function fmt(sec){ sec=Math.floor(sec||0); const m=Math.floor(sec/60); const s=String(sec%60).padStart(2,'0'); return `${m}:${s}`; }
  global.YouTubeEmbed = YouTubeEmbed;
})(window);
