import { Server, type Connection, type WSMessage, routePartykitRequest } from "partyserver";

export class Chat extends Server<Env> {
  static options = {
    hibernate: false
  };

  players = new Map<string, any>();
  gameState: any = null;
  lastSkillClass = null;
  botTimer: any = null;
  resetTimer: any = null;

  // ========== MÉTODOS AUXILIARES ==========
  getClassStats(className: string) {
    const stats: Record<string, any> = {
      TANK: { maxHp: 220, minDamage: 25, maxDamage: 45, speed: 3000, accuracy: 1.00 },
      WARRIOR: { maxHp: 150, minDamage: 50, maxDamage: 80, speed: 2500, accuracy: 0.90 },
      ARCHER: { maxHp: 90, minDamage: 35, maxDamage: 65, speed: 1000, accuracy: 0.80 },
      MAGE: { maxHp: 85, minDamage: 80, maxDamage: 130, speed: 2800, accuracy: 0.70 },
      PRIEST: { maxHp: 80, minDamage: 0, maxDamage: 0, speed: 4000, accuracy: 1.00 }
    };
    return stats[className] || stats.WARRIOR;
  }

  getRandomAIClass() {
    const classes = ["TANK", "WARRIOR", "ARCHER", "MAGE", "PRIEST"];
    return classes[Math.floor(Math.random() * classes.length)];
  }

  ensureAI() {
    const aiId = "AI-1";
    for (const [id, player] of this.players) {
      if (player.isAI && id !== aiId) {
        this.players.delete(id);
      }
    }

    let ai = this.players.get(aiId);
    if (!ai) {
      const aiClass = this.getRandomAIClass();
      const stats = this.getClassStats(aiClass);
      ai = {
        id: aiId,
        name: "Arena AI",
        class: aiClass,
        position: 0,
        level: 1,
        xp: 0,
        maxHp: stats.maxHp,
        hp: stats.maxHp,
        totalDamage: 0,
        healing: 0,
        alive: true,
        taunt: false,
        isAI: true
      };
      this.players.set(aiId, ai);
      console.log("🤖 IA CRIADA:", ai.class);
    }
    return ai;
  }

  scheduleAIAttack(delay?: number) {
    if (this.botTimer) {
      clearTimeout(this.botTimer);
      this.botTimer = null;
    }

    const ai = this.players.get("AI-1");
    const stats = ai ? this.getClassStats(ai.class) : this.getClassStats("WARRIOR");
    const wait = typeof delay === "number" ? delay : stats.speed;

    this.botTimer = setTimeout(() => {
      this.botTimer = null;
      this.aiAttack();
      this.scheduleAIAttack();
    }, wait);
    
    console.log("⏱️ PRÓXIMO ATAQUE IA EM:", wait, "ms");
  }

  aiAttack() {
    console.log("🤖 IA ATACANDO...");
    
    if (!this.gameState) {
      console.log("❌ Sem gameState");
      return;
    }
    
    if (this.gameState.bossHp <= 0) {
      console.log("❌ Boss já morreu");
      return;
    }

    const livingPlayers = [...this.players.values()].filter(player => player.alive);
    if (livingPlayers.length === 0) {
      console.log("❌ Sem jogadores vivos");
      return;
    }

    const ai = this.players.get("AI-1");
    if (!ai) {
      console.log("❌ IA não encontrada");
      return;
    }

    if (!ai.alive || ai.hp <= 0) {
      console.log("❌ IA está morta");
      return;
    }

    const stats = this.getClassStats(ai.class);
    console.log("🤖 IA CLASSE:", ai.class);

    if (ai.class === "PRIEST") {
      const damagedPlayers = livingPlayers.filter(
        player => !player.isAI && player.hp < player.maxHp
      );
      if (damagedPlayers.length === 0) return;
      
      damagedPlayers.sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp));
      const target = damagedPlayers[0];

      let heal = Math.floor(Math.random() * 16) + 15 + ai.level * 2;
      const healingPower = typeof ai.healingPower === "number" ? ai.healingPower : 1;
      heal = Math.floor(heal * healingPower);
      heal = Math.min(heal, target.maxHp - target.hp);
      
      if (heal <= 0) return;

      target.hp += heal;
      ai.healing += heal;
      this.players.set(target.id, target);
      this.players.set(ai.id, ai);

      this.broadcast(JSON.stringify({
        type: "healResult",
        healerId: ai.id,
        healerName: ai.name,
        healerClass: ai.class,
        targetId: target.id,
        targetName: target.name,
        heal: heal,
        hp: target.hp,
        maxHp: target.maxHp,
        alive: target.alive,
        healerHealing: ai.healing,
        isAI: true
      }));
      console.log("💚 IA CUROU:", target.name, "+", heal);
      return;
    }

    if (Math.random() > stats.accuracy) {
      this.broadcast(JSON.stringify({
        type: "attackResult",
        playerId: ai.id,
        name: ai.name,
        class: ai.class,
        hit: false,
        damage: 0,
        critical: false,
        bossHp: this.gameState.bossHp,
        maxBossHp: this.gameState.maxBossHp,
        totalDamage: ai.totalDamage,
        level: ai.level,
        isAI: true
      }));
      console.log("❌ IA ERROU");
      return;
    }

    let damage = Math.floor(Math.random() * (stats.maxDamage - stats.minDamage + 1)) + stats.minDamage;
    damage = Math.floor(damage * (1 + (ai.level - 1) * 0.08));
    const critical = Math.random() < 0.11;
    if (critical) damage *= 2;
    damage = Math.min(damage, this.gameState.bossHp);
    
    this.gameState.bossHp -= damage;
    ai.totalDamage += damage;
    this.players.set(ai.id, ai);

    this.broadcast(JSON.stringify({
      type: "attackResult",
      playerId: ai.id,
      name: ai.name,
      class: ai.class,
      hit: true,
      damage: damage,
      critical: critical,
      bossHp: this.gameState.bossHp,
      maxBossHp: this.gameState.maxBossHp,
      totalDamage: ai.totalDamage,
      level: ai.level,
      isAI: true
    }));
    
    console.log("⚔️ IA ATACOU:", ai.name, "-", damage, "dano" + (critical ? " 💥CRÍTICO!" : ""));
  }

  getOrderedPlayers() {
    return [...this.players.values()].sort((a, b) => a.position - b.position);
  }

  sendRoomState(connection) {
    connection.send(JSON.stringify({
      type: "roomState",
      players: this.getOrderedPlayers(),
      gameState: this.gameState
    }));
  }

  broadcastRoomState() {
    this.broadcast(JSON.stringify({
      type: "roomState",
      players: this.getOrderedPlayers(),
      gameState: this.gameState
    }));
  }

  scheduleGameReset() {
    if (this.resetTimer) return;
    this.resetTimer = setTimeout(() => {
      this.resetTimer = null;
      this.ensureAI();
      for (const [id, player] of this.players) {
        if (player.isAI) continue;
        const stats = this.getClassStats(player.class);
        player.maxHp = stats.maxHp;
        player.hp = stats.maxHp;
        player.alive = true;
        player.taunt = false;
        player.totalDamage = 0;
        player.healing = 0;
        player.level = 1;
        player.xp = 0;
        this.players.set(id, player);
      }
      const ai = this.players.get("AI-1");
      if (ai) {
        const newClass = this.getRandomAIClass();
        const stats = this.getClassStats(newClass);
        ai.position = 0;
        ai.class = newClass;
        ai.maxHp = stats.maxHp;
        ai.hp = stats.maxHp;
        ai.alive = true;
        ai.taunt = false;
        ai.totalDamage = 0;
        ai.healing = 0;
        ai.level = 1;
        ai.xp = 0;
        ai.isAI = true;
        this.players.set("AI-1", ai);
      }
      const boss = this.gameState?.currentBoss || { name: "THE DEMON", icon: "👹", hp: 10000 };
      const hp = Number(boss.hp) || 10000;
      this.gameState = { bossLevel: 1, currentBoss: boss, maxBossHp: hp, bossHp: hp, wins: 0, nextBossAttackAt: 0 };
      if (this.botTimer) {
        clearTimeout(this.botTimer);
        this.botTimer = null;
      }
      this.scheduleAIAttack();
      this.broadcast(JSON.stringify({ type: "roomState", reset: true, players: this.getOrderedPlayers(), gameState: this.gameState }));
      console.log("🔄 AUTOMATIC GAME RESET");
    }, 10000);
  }

  // ========== TWITCH INTEGRAÇÃO ==========
  private twitchSocket: WebSocket | null = null;
  private twitchBuffer = "";
  private twitchReconnectTimer: any = null;
  private twitchConnected = false;
  private refreshRetryTimer: any = null;

  private getWorkerEnv(): any {
    return (this as any).env;
  }

  async resetTwitchAuth() {
    console.log("🧹 RESETANDO AUTENTICAÇÃO TWITCH...");
    try {
      await this.ctx.storage.delete("twitch_access_token");
      await this.ctx.storage.delete("twitch_refresh_token");
      await this.ctx.storage.delete("twitch_enabled");
      await this.ctx.storage.delete("twitch_bot_login");
      await this.ctx.storage.delete("twitch_oauth_state");
      await this.ctx.storage.delete("twitch_token_expires_at");
      
      if (this.twitchSocket) {
        try { this.twitchSocket.close(); } catch {}
        this.twitchSocket = null;
      }
      if (this.refreshRetryTimer) {
        clearTimeout(this.refreshRetryTimer);
        this.refreshRetryTimer = null;
      }
      this.twitchConnected = false;
      
      console.log("✅ AUTENTICAÇÃO TWITCH RESETADA!");
      return { success: true };
    } catch (error) {
      console.error("❌ ERRO AO RESETAR:", error);
      return { success: false, error: String(error) };
    }
  }

  async startTwitchOAuth() {
    const env = this.getWorkerEnv();
    if (!env?.TWITCH_CLIENT_ID) {
      throw new Error("TWITCH_CLIENT_ID não configurado");
    }

    const state = crypto.randomUUID();
    await this.ctx.storage.put("twitch_oauth_state", {
      value: state,
      expiresAt: Date.now() + 10 * 60 * 1000
    });

    const redirectUri = env.TWITCH_REDIRECT_URI || "https://durable-chat-template.marcelcantagalo.workers.dev/twitch/callback";

    const params = new URLSearchParams({
      client_id: env.TWITCH_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "chat:read chat:edit",
      state
    });

    return `https://id.twitch.tv/oauth2/authorize?${params.toString()}`;
  }

  async completeTwitchOAuth(code: string, state: string) {
    const env = this.getWorkerEnv();
    const savedState: any = await this.ctx.storage.get("twitch_oauth_state");

    if (!savedState || savedState.value !== state || Number(savedState.expiresAt) < Date.now()) {
      throw new Error("OAuth state inválido ou expirado");
    }

    await this.ctx.storage.delete("twitch_oauth_state");

    const redirectUri = env.TWITCH_REDIRECT_URI || "https://durable-chat-template.marcelcantagalo.workers.dev/twitch/callback";

    const tokenResponse = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.TWITCH_CLIENT_ID,
        client_secret: env.TWITCH_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri
      })
    });

    if (!tokenResponse.ok) {
      const text = await tokenResponse.text();
      throw new Error(`Twitch OAuth falhou: ${text}`);
    }

    const tokenData: any = await tokenResponse.json();

    const userResponse = await fetch("https://api.twitch.tv/helix/users", {
      headers: {
        "Client-Id": env.TWITCH_CLIENT_ID,
        "Authorization": `Bearer ${tokenData.access_token}`
      }
    });

    if (!userResponse.ok) {
      throw new Error("Não foi possível validar a conta da Twitch");
    }

    const userData: any = await userResponse.json();
    const twitchUser = userData.data?.[0];

    if (!twitchUser) {
      throw new Error("Conta da Twitch não encontrada");
    }

    // SALVA O REFRESH TOKEN E O ACCESS TOKEN
    await this.ctx.storage.put("twitch_access_token", tokenData.access_token);
    // IMPORTANTE: A Twitch pode não retornar refresh_token em alguns fluxos, mas aqui deve vir
    if (tokenData.refresh_token) {
      await this.ctx.storage.put("twitch_refresh_token", tokenData.refresh_token);
    } else {
      console.warn("⚠️ Nenhum refresh_token recebido. O token pode não ser renovável automaticamente.");
    }
    await this.ctx.storage.put("twitch_bot_login", twitchUser.login);
    await this.ctx.storage.put("twitch_enabled", true);
    // Define expiração para ~4 horas (valor típico da Twitch)
    await this.ctx.storage.put("twitch_token_expires_at", Date.now() + 4 * 60 * 60 * 1000);

    console.log("✅ Token salvo com sucesso. Refresh token presente:", !!tokenData.refresh_token);

    await this.connectTwitchChat();
    return true;
  }

  // ========== MÉTODO PRINCIPAL COM RENOVAÇÃO AUTOMÁTICA MELHORADA ==========
  private async connectTwitchChat() {
    // Se já estiver conectado, não faz nada
    if (this.twitchSocket && this.twitchConnected) {
      console.log("🟣 Twitch chat já está conectado");
      return;
    }

    // Limpa timers de retry anteriores
    if (this.refreshRetryTimer) {
      clearTimeout(this.refreshRetryTimer);
      this.refreshRetryTimer = null;
    }

    const enabled = await this.ctx.storage.get("twitch_enabled");
    let token: any = await this.ctx.storage.get("twitch_access_token");
    const refreshToken: any = await this.ctx.storage.get("twitch_refresh_token");
    const login: any = await this.ctx.storage.get("twitch_bot_login");
    const expiresAt: any = await this.ctx.storage.get("twitch_token_expires_at");

    if (!enabled || !login) {
      console.log("⚠️ Twitch não está habilitado ou faltam credenciais");
      return;
    }

    // Verifica se o token expirou ou está perto de expirar
    let needsRefresh = false;
    if (token && expiresAt) {
      const timeUntilExpiry = Number(expiresAt) - Date.now();
      if (timeUntilExpiry < 5 * 60 * 1000) { // menos de 5 minutos
        console.log(`⏳ Token expira em ${Math.round(timeUntilExpiry / 60000)} minutos. Renovando...`);
        needsRefresh = true;
      }
    } else if (!token) {
      needsRefresh = true;
    }

    // Se precisar renovar e tiver refresh token, tenta
    if (needsRefresh && refreshToken) {
      try {
        const env = this.getWorkerEnv();
        console.log("🔄 Tentando renovar token do Twitch...");
        
        const response = await fetch("https://id.twitch.tv/oauth2/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: env.TWITCH_CLIENT_ID,
            client_secret: env.TWITCH_CLIENT_SECRET,
            refresh_token: refreshToken,
            grant_type: "refresh_token"
          })
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error("❌ Falha ao renovar token:", errorText);
          // Se falhar por token inválido, limpa os tokens para forçar reautorização
          if (response.status === 400 && errorText.includes("invalid refresh token")) {
            console.warn("⚠️ Refresh token inválido. Será necessário reautorizar.");
            await this.ctx.storage.delete("twitch_access_token");
            await this.ctx.storage.delete("twitch_refresh_token");
            await this.ctx.storage.delete("twitch_token_expires_at");
            token = null;
          } else {
            // Outro erro: tenta novamente em 30 segundos
            console.log("🔄 Agendando nova tentativa de refresh em 30 segundos...");
            this.refreshRetryTimer = setTimeout(() => {
              this.refreshRetryTimer = null;
              this.connectTwitchChat();
            }, 30000);
            return;
          }
        } else {
          const data: any = await response.json();
          token = data.access_token;
          await this.ctx.storage.put("twitch_access_token", token);
          // A Twitch pode ou não retornar um novo refresh_token; se retornar, atualiza
          if (data.refresh_token) {
            await this.ctx.storage.put("twitch_refresh_token", data.refresh_token);
          }
          await this.ctx.storage.put("twitch_token_expires_at", Date.now() + 4 * 60 * 60 * 1000);
          console.log("✅ Token do Twitch renovado automaticamente!");
        }
      } catch (error) {
        console.error("❌ Erro ao renovar token:", error);
        // Tenta novamente em 30 segundos
        console.log("🔄 Agendando nova tentativa de refresh em 30 segundos...");
        this.refreshRetryTimer = setTimeout(() => {
          this.refreshRetryTimer = null;
          this.connectTwitchChat();
        }, 30000);
        return;
      }
    }

    // Se ainda não tem token, pede re-autorização
    if (!token) {
      console.log("⚠️ Token inválido ou expirado. Reautorize o Twitch em: /twitch/login");
      return;
    }

    // ===== CONECTA AO WEBSOCKET =====
    try {
      console.log("🟣 Conectando ao Twitch chat...");
      
      // Fecha socket antigo se existir
      if (this.twitchSocket) {
        try { this.twitchSocket.close(); } catch {}
        this.twitchSocket = null;
      }
      
      const socket = new WebSocket("wss://irc-ws.chat.twitch.tv:443");
      this.twitchSocket = socket;
      this.twitchBuffer = "";
      this.twitchConnected = false;

      socket.addEventListener("open", () => {
        console.log("🟣 WebSocket Twitch aberto - enviando comandos...");
        
        socket.send("CAP REQ :twitch.tv/tags twitch.tv/commands\r\n");
        socket.send(`PASS oauth:${token}\r\n`);
        socket.send(`NICK ${String(login).toLowerCase()}\r\n`);
        socket.send("JOIN #bossfightlivearena\r\n");
        
        console.log("📤 Comandos enviados: CAP, PASS, NICK, JOIN");
        this.twitchConnected = true;
      });

      socket.addEventListener("message", (event: MessageEvent) => {
        const data = String(event.data);
        console.log("📨 RAW TWITCH:", data);
        this.handleTwitchMessage(data);
      });

      socket.addEventListener("close", (event) => {
        console.log(`🔴 Twitch chat desconectado - Código: ${event.code} - Motivo: ${event.reason || "sem motivo"}`);
        this.twitchSocket = null;
        this.twitchConnected = false;
        this.scheduleTwitchReconnect();
      });

      socket.addEventListener("error", (error) => {
        console.error("❌ Erro no Twitch socket:", error);
        this.twitchConnected = false;
        try { socket.close(); } catch {}
      });

    } catch (error) {
      console.error("❌ Erro ao conectar Twitch:", error);
      this.twitchSocket = null;
      this.twitchConnected = false;
      this.scheduleTwitchReconnect();
    }
  }

  private scheduleTwitchReconnect() {
    if (this.twitchReconnectTimer) return;
    console.log("🔄 Agendando reconexão Twitch em 10 segundos...");
    this.twitchReconnectTimer = setTimeout(() => {
      this.twitchReconnectTimer = null;
      // Tenta reconectar chamando connectTwitchChat, que também tenta refresh se necessário
      this.connectTwitchChat();
    }, 10000);
  }

  private handleTwitchMessage(rawData: string) {
    this.twitchBuffer += rawData;
    const lines = this.twitchBuffer.split("\r\n");
    this.twitchBuffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("PING")) {
        if (this.twitchSocket) {
          this.twitchSocket.send("PONG :tmi.twitch.tv\r\n");
          console.log("📤 PONG enviado");
        }
        continue;
      }

      if (line.includes(" PRIVMSG #bossfightlivearena :")) {
        const commandIndex = line.indexOf(" PRIVMSG #bossfightlivearena :");
        const messageText = line.slice(commandIndex + " PRIVMSG #bossfightlivearena :".length).trim();

        console.log(`📨 Mensagem recebida: "${messageText}"`);

        if (messageText.toLowerCase() === "!play") {
          const tagPart = line.startsWith("@") ? line.slice(1, line.indexOf(" ")) : "";
          const tags: Record<string, string> = {};

          for (const tag of tagPart.split(";")) {
            const separator = tag.indexOf("=");
            if (separator === -1) continue;
            tags[tag.slice(0, separator)] = tag.slice(separator + 1);
          }

          const userId = tags["user-id"];
          const displayName = tags["display-name"] || line.match(/^:([^!]+)!/)?.[1] || "Player";

          console.log(`🎯 Comando !play de ${displayName} (${userId})`);

          if (userId) {
            this.addTwitchPlayer(userId, displayName);
          }
        }
      }
      
      if (line.includes(" 366 ")) {
        console.log("✅ Bot entrou no canal #bossfightlivearena!");
      }
    }
  }

  async addTwitchPlayer(twitchUserId: string, twitchName: string) {
    if (!twitchUserId) {
      return { ok: false, reason: "missing-user-id" };
    }

    const existing = [...this.players.values()].find(
      player => player.twitchUserId === twitchUserId
    );

    if (existing) {
      console.log(`⚠️ ${twitchName} já está no jogo`);
      return { ok: false, reason: "already-playing", player: existing };
    }

    this.ensureAI();

    const validClasses = ["TANK", "WARRIOR", "ARCHER", "MAGE", "PRIEST"];
    const playerClass = validClasses[Math.floor(Math.random() * validClasses.length)];
    const stats = this.getClassStats(playerClass);
    const cleanName = String(twitchName || "Player").trim().slice(0, 8) || "Player";
    const playerId = `TWITCH-${twitchUserId}`;

    const humanPositions = [...this.players.values()]
      .filter(player => !player.isAI)
      .map(player => Number(player.position))
      .filter(position => Number.isFinite(position));

    const position = humanPositions.length > 0 ? Math.max(...humanPositions) + 1 : 0;

    const player = {
      id: playerId,
      twitchUserId,
      name: cleanName,
      class: playerClass,
      position,
      level: 1,
      xp: 0,
      maxHp: stats.maxHp,
      hp: stats.maxHp,
      totalDamage: 0,
      healing: 0,
      alive: true,
      taunt: false,
      isAI: false,          // <-- GARANTIDO QUE É FALSE PARA JOGADORES DA TWITCH
      isTwitch: true
    };

  // ========== CICLO DE VIDA ==========
  onStart() {
    console.log("🔥 BOSS FIGHT SERVER STARTED");
    
    if (!this.gameState) {
      const boss = { name: "DEMON LORD", icon: "👹", hp: 10000, special: false };
      this.gameState = {
        bossLevel: 1,
        currentBoss: boss,
        maxBossHp: 10000,
        bossHp: 10000,
        wins: 0,
        nextBossAttackAt: 0
      };
      console.log("🎮 GAME STATE INICIALIZADO:", this.gameState);
    }
    
    this.ensureAI();
    
    if (this.botTimer) {
      clearTimeout(this.botTimer);
      this.botTimer = null;
    }
    this.scheduleAIAttack(1000);
    
    this.connectTwitchChat();
  }

  onConnect(connection: Connection) {
    this.ensureAI();
    console.log("🟢 PLAYER CONNECTED:", connection.id);
    
    if (!this.botTimer) {
      this.scheduleAIAttack(1000);
    }
    
    this.sendRoomState(connection);
  }

  onMessage(connection: Connection, message: WSMessage) {
    try {
      const data: any = JSON.parse(message as string);

      if (data.type === "initGame") {
        if (this.gameState === null) {
          this.gameState = {
            bossLevel: data.gameState.bossLevel,
            currentBoss: data.gameState.currentBoss,
            maxBossHp: data.gameState.maxBossHp,
            bossHp: data.gameState.bossHp,
            wins: data.gameState.wins,
            nextBossAttackAt: 0
          };
          console.log("🎮 GAME CREATED:", this.gameState);
        }
        this.ensureAI();
        this.broadcastRoomState();
        return;
      }

      if (data.type === "join") {
        if (this.players.has(connection.id)) return;

        let maxHp = 100;
        if (data.class === "TANK") maxHp = 220;
        else if (data.class === "WARRIOR") maxHp = 150;
        else if (data.class === "ARCHER") maxHp = 90;
        else if (data.class === "MAGE") maxHp = 85;
        else if (data.class === "PRIEST") maxHp = 80;

        const player = {
          id: connection.id,
          name: data.name || "Player",
          class: data.class || "WARRIOR",
          position: this.players.size,
          level: 1,
          xp: 0,
          maxHp: maxHp,
          hp: maxHp,
          totalDamage: 0,
          healing: 0,
          alive: true,
          taunt: false
        };

        this.players.set(connection.id, player);
        this.broadcast(JSON.stringify({ type: "playerJoined", player: player }), [connection.id]);
        this.sendRoomState(connection);
        console.log("⚔️ PLAYER JOINED:", player.name, player.class);
        return;
      }

      if (data.type === "attack") {
    // 🔥 USA O playerId ENVIADO PELO CLIENTE
    const playerId = data.playerId || connection.id;
    const player = this.players.get(playerId);
    
    if (!player || !this.gameState || this.gameState.bossHp <= 0 || !player.alive) return;

    let attackChance;
    if (player.class === "TANK") attackChance = 1.00;
    else if (player.class === "WARRIOR") attackChance = 0.90;
    else if (player.class === "ARCHER") attackChance = 0.80;
    else if (player.class === "MAGE") attackChance = 0.70;
    else attackChance = 1.00;

    if (Math.random() > attackChance) {
        this.broadcast(JSON.stringify({
            type: "attackResult",
            playerId: player.id,
            name: player.name,
            hit: false,
            damage: 0,
            critical: false,
            bossHp: this.gameState.bossHp,
            maxBossHp: this.gameState.maxBossHp
        }));
        return;
    }

    let minDamage = 0, maxDamage = 0;
    if (player.class === "TANK") { minDamage = 25; maxDamage = 45; }
    else if (player.class === "WARRIOR") { minDamage = 50; maxDamage = 80; }
    else if (player.class === "ARCHER") { minDamage = 35; maxDamage = 65; }
    else if (player.class === "MAGE") { minDamage = 80; maxDamage = 130; }
    else return;

    let damage = Math.floor(Math.random() * (maxDamage - minDamage + 1)) + minDamage;
    damage = Math.floor(damage * (1 + (player.level - 1) * 0.08));
    const critical = Math.random() < 0.11;
    if (critical) damage *= 2;
    damage = Math.min(damage, this.gameState.bossHp);

    this.gameState.bossHp -= damage;
    player.totalDamage += damage;
    this.players.set(playerId, player); // USA playerId

    this.broadcast(JSON.stringify({
        type: "attackResult",
        playerId: player.id,
        name: player.name,
        class: player.class,
        hit: true,
        damage: damage,
        critical: critical,
        bossHp: this.gameState.bossHp,
        maxBossHp: this.gameState.maxBossHp,
        totalDamage: player.totalDamage,
        level: player.level
    }));
    return;
}

      if (data.type === "bossAttack") {
        if (!this.gameState || this.gameState.bossHp <= 0) return;

        const now = Date.now();
        const nextBossAttackAt = Number(this.gameState.nextBossAttackAt || 0);
        if (now < nextBossAttackAt) return;

        const alivePlayers = [...this.players.values()].filter(player => player.alive);
        if (alivePlayers.length === 0) return;

        const tauntPlayers = alivePlayers.filter(player => player.taunt === true);
        let target;
        if (tauntPlayers.length > 0) {
          target = tauntPlayers[Math.floor(Math.random() * tauntPlayers.length)];
        } else {
          const targetWeights = { "TANK": 40, "WARRIOR": 25, "ARCHER": 18, "MAGE": 12, "PRIEST": 5 };
          const weightedPlayers = [];
          alivePlayers.forEach(player => {
            const weight = targetWeights[player.class] || 1;
            for (let i = 0; i < weight; i++) {
              weightedPlayers.push(player);
            }
          });
          target = weightedPlayers[Math.floor(Math.random() * weightedPlayers.length)];
        }

        if (!target) return;

        const bossSpells = [
          ["💥", "DEMON STRIKE", 45],
          ["🔥", "HELLFIRE", 55],
          ["⚡", "DARK LIGHTNING", 60],
          ["👻", "SOUL RIP", 50]
        ];
        const spell = bossSpells[Math.floor(Math.random() * bossSpells.length)];

        let damage = Math.floor(spell[2] * (1 + this.gameState.bossLevel * 0.10));
        if (this.gameState.bossLevel > 20) {
          damage = Math.floor(damage * (1 + (this.gameState.bossLevel - 20) * 0.05));
        }
        if (this.gameState.currentBoss?.special) {
          damage = Math.floor(damage * 1.5);
        }
        if (this.gameState.bossHp <= this.gameState.maxBossHp * 0.25) {
          damage = Math.floor(damage * 1.5);
        }
        if (target.class === "TANK") {
          damage = Math.floor(damage * 0.65);
        }
        damage = Math.min(damage, target.hp);

        target.hp -= damage;
        if (target.hp <= 0) {
          target.hp = 0;
          target.alive = false;
        }
        this.players.set(target.id, target);

        let attackSpeed = 5000 - (this.gameState.bossLevel - 1) * 40;
        attackSpeed = Math.max(2500, attackSpeed);
        if (this.gameState.bossHp <= this.gameState.maxBossHp * 0.25) {
          attackSpeed = Math.floor(attackSpeed * 0.70);
        }
        this.gameState.nextBossAttackAt = Date.now() + attackSpeed;

        this.broadcast(JSON.stringify({
          type: "bossAttackResult",
          targetId: target.id,
          targetName: target.name,
          targetClass: target.class,
          spellIcon: spell[0],
          spellName: spell[1],
          damage: damage,
          hp: target.hp,
          maxHp: target.maxHp,
          alive: target.alive
        }));

        const aliveAfterBossAttack = [...this.players.values()].filter(player => player.alive);
        if (aliveAfterBossAttack.length === 0) {
          this.scheduleGameReset();
        }

        console.log("👹 BOSS ATTACK:", target.name, "-", damage, "HP");
        return;
      }

      if (data.type === "nextBoss") {
        if (!this.gameState) return;
        const expectedBossLevel = this.gameState.bossLevel + 1;
        if (Number(data.bossLevel) !== expectedBossLevel) return;
        if (!data.currentBoss || !data.currentBoss.name || !data.currentBoss.icon || !data.currentBoss.hp) return;

        this.gameState = {
          bossLevel: Number(data.bossLevel),
          currentBoss: data.currentBoss,
          maxBossHp: Number(data.maxBossHp) || Number(data.currentBoss.hp),
          bossHp: Number(data.bossHp) || Number(data.currentBoss.hp),
          wins: this.gameState.wins,
          nextBossAttackAt: 0
        };

        console.log("👑 NEXT BOSS OFFICIAL:", this.gameState.bossLevel, this.gameState.currentBoss.name);
        this.broadcastRoomState();
        return;
      }

      if (data.type === "resetGame") {
        if (this.resetTimer) {
          clearTimeout(this.resetTimer);
          this.resetTimer = null;
        }

        this.ensureAI();
        for (const [id, player] of this.players) {
          if (player.isAI) continue;
          const stats = this.getClassStats(player.class);
          player.maxHp = stats.maxHp;
          player.hp = stats.maxHp;
          player.alive = true;
          player.taunt = false;
          player.totalDamage = 0;
          player.healing = 0;
          player.level = 1;
          player.xp = 0;
          this.players.set(id, player);
        }

        const resetBoss = data.gameState?.currentBoss || this.gameState?.currentBoss;
        const resetLevel = Number(data.gameState?.bossLevel) || 1;
        const resetMaxHp = Number(data.gameState?.maxBossHp) || Number(resetBoss?.hp) || 10000;

        this.gameState = {
          bossLevel: resetLevel,
          currentBoss: resetBoss,
          maxBossHp: resetMaxHp,
          bossHp: resetMaxHp,
          wins: 0,
          nextBossAttackAt: 0
        };

        const ai = this.players.get("AI-1");
        if (ai) {
          const newClass = this.getRandomAIClass();
          const stats = this.getClassStats(newClass);
          ai.position = 0;
          ai.class = newClass;
          ai.maxHp = stats.maxHp;
          ai.hp = stats.maxHp;
          ai.alive = true;
          ai.taunt = false;
          ai.totalDamage = 0;
          ai.healing = 0;
          ai.level = 1;
          ai.xp = 0;
          ai.isAI = true;
          this.players.set("AI-1", ai);
        }

        if (this.botTimer) {
          clearTimeout(this.botTimer);
          this.botTimer = null;
        }
        this.scheduleAIAttack();

        this.broadcast(JSON.stringify({
          type: "roomState",
          reset: true,
          players: this.getOrderedPlayers(),
          gameState: this.gameState
        }));
        return;
      }

    } catch (error) {
      console.error("❌ MESSAGE ERROR:", error);
    }
  }

  onClose(connection: Connection) {
    const player = this.players.get(connection.id);
    if (player) {
      this.players.delete(connection.id);
      this.broadcast(JSON.stringify({
        type: "playerLeft",
        playerId: connection.id
      }));
      console.log("🔴 PLAYER LEFT:", player.name);
    }
  }
}

export default {
  async fetch(request: Request, env: any) {
    const url = new URL(request.url);

    // Rotas do Twitch
    if (url.pathname === "/twitch/reset") {
      try {
        const id = env.Chat.idFromName("bossfight");
        const stub = env.Chat.get(id);
        const result = await stub.resetTwitchAuth();
        return new Response(
          JSON.stringify(result),
          { 
            status: result.success ? 200 : 500,
            headers: { "Content-Type": "application/json" }
          }
        );
      } catch (error) {
        console.error("❌ RESET ERROR:", error);
        return new Response(
          JSON.stringify({ success: false, error: String(error) }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    if (url.pathname === "/twitch/login") {
      try {
        const id = env.Chat.idFromName("bossfight");
        const stub = env.Chat.get(id);
        const twitchUrl = await stub.startTwitchOAuth();
        return Response.redirect(twitchUrl, 302);
      } catch (error) {
        console.error("❌ TWITCH LOGIN ERROR:", error);
        return new Response(
          `Erro: ${error instanceof Error ? error.message : String(error)}`,
          { status: 500 }
        );
      }
    }

    if (url.pathname === "/twitch/callback") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");

      if (!code || !state) {
        return new Response("Parâmetros ausentes", { status: 400 });
      }

      try {
        const id = env.Chat.idFromName("bossfight");
        const stub = env.Chat.get(id);
        await stub.completeTwitchOAuth(code, state);
        return new Response(
          "✅ Twitch conectado com sucesso! Use !play no chat.",
          { headers: { "Content-Type": "text/plain; charset=utf-8" } }
        );
      } catch (error) {
        console.error("❌ TWITCH CALLBACK ERROR:", error);
        return new Response(
          `Erro: ${error instanceof Error ? error.message : String(error)}`,
          { status: 500 }
        );
      }
    }

    // PartyKit
    const response = await routePartykitRequest(request, { ...env });
    if (response) return response;

    // Assets (HTML)
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not found", { status: 404 });
  }
};
