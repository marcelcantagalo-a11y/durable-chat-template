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
  private twitchSocket: WebSocket | null = null;
  private twitchBuffer = "";
  private twitchReconnectTimer: any = null;

  // ============================================
  // MÉTODOS AUXILIARES
  // ============================================

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

  // ============================================
  // IA DO SERVIDOR
  // ============================================

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
    }
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
  }

  aiAttack() {
    if (!this.gameState || this.gameState.bossHp <= 0) return;
    
    const livingPlayers = [...this.players.values()].filter(player => player.alive);
    if (livingPlayers.length === 0) return;

    this.ensureAI();
    const ai = this.players.get("AI-1");
    if (!ai || !ai.alive || ai.hp <= 0) return;

    const stats = this.getClassStats(ai.class);

    // PRIEST cura
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
      return;
    }

    // ATAQUE
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
  }

  // ============================================
  // GESTÃO DA SALA
  // ============================================

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
      // Código de reset...
    }, 10000);
  }

  // ============================================
  // ⭐ TWITCH INTEGRAÇÃO CORRIGIDA
  // ============================================

  // Método para iniciar OAuth
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

    const redirectUri = env.TWITCH_REDIRECT_URI || "https://durable-chat-template.marcelcantagalo.workers.dev/";

    const params = new URLSearchParams({
      client_id: env.TWITCH_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "chat:read chat:edit",
      state
    });

    return `https://id.twitch.tv/oauth2/authorize?${params.toString()}`;
  }

  // Método para completar OAuth
  async completeTwitchOAuth(code: string, state: string) {
    const env = this.getWorkerEnv();
    const savedState: any = await this.ctx.storage.get("twitch_oauth_state");
    
    if (!savedState || savedState.value !== state || Number(savedState.expiresAt) < Date.now()) {
      throw new Error("OAuth state inválido ou expirado");
    }

    await this.ctx.storage.delete("twitch_oauth_state");

    const redirectUri = env.TWITCH_REDIRECT_URI || "https://durable-chat-template.marcelcantagalo.workers.dev/";

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

    // Valida a conta
    const userResponse = await fetch("https://api.twitch.tv/helix/users", {
      headers: {
        "Client-Id": env.TWITCH_CLIENT_ID,
        "Authorization": `Bearer ${tokenData.access_token}`
      }
    });

    const userData: any = await userResponse.json();
    const twitchUser = userData.data?.[0];

    if (!twitchUser) {
      throw new Error("Não foi possível validar a conta da Twitch");
    }

    // Salva os tokens
    await this.ctx.storage.put("twitch_access_token", tokenData.access_token);
    await this.ctx.storage.put("twitch_refresh_token", tokenData.refresh_token || null);
    await this.ctx.storage.put("twitch_bot_login", twitchUser.login);
    await this.ctx.storage.put("twitch_enabled", true);

    // Conecta ao chat
    await this.connectTwitchChat();
    
    return true;
  }

  // Conectar ao chat da Twitch
  private async connectTwitchChat() {
    if (this.twitchSocket) return;

    const enabled = await this.ctx.storage.get("twitch_enabled");
    const token: any = await this.ctx.storage.get("twitch_access_token");
    const login: any = await this.ctx.storage.get("twitch_bot_login");

    if (!enabled || !token || !login) {
      console.log("⚠️ Twitch não está habilitado");
      return;
    }

    try {
      console.log("🟣 Conectando ao Twitch...");
      
      const socket = new WebSocket("wss://irc-ws.chat.twitch.tv:443");
      this.twitchSocket = socket;
      this.twitchBuffer = "";

      socket.addEventListener("open", () => {
        console.log("🟣 WebSocket Twitch conectado");
        socket.send("CAP REQ :twitch.tv/tags twitch.tv/commands\r\n");
        socket.send(`PASS oauth:${token}\r\n`);
        socket.send(`NICK ${String(login).toLowerCase()}\r\n`);
        socket.send("JOIN #bossfightlivearena\r\n");
        console.log("🟣 Twitch chat conectado com sucesso!");
      });

      socket.addEventListener("message", (event: MessageEvent) => {
        this.handleTwitchMessage(String(event.data));
      });

      socket.addEventListener("close", () => {
        console.log("🔴 Twitch chat desconectado");
        this.twitchSocket = null;
        this.scheduleTwitchReconnect();
      });

      socket.addEventListener("error", (error) => {
        console.error("❌ Erro no Twitch socket:", error);
        try { socket.close(); } catch {}
      });

    } catch (error) {
      console.error("❌ Erro ao conectar Twitch:", error);
      this.twitchSocket = null;
      this.scheduleTwitchReconnect();
    }
  }

  private scheduleTwitchReconnect() {
    if (this.twitchReconnectTimer) return;
    this.twitchReconnectTimer = setTimeout(() => {
      this.twitchReconnectTimer = null;
      this.connectTwitchChat();
    }, 10000);
  }

  // Processa mensagens do IRC
  private handleTwitchMessage(rawData: string) {
    this.twitchBuffer += rawData;
    const lines = this.twitchBuffer.split("\r\n");
    this.twitchBuffer = lines.pop() || "";

    for (const line of lines) {
      // PING
      if (line.startsWith("PING")) {
        if (this.twitchSocket) {
          this.twitchSocket.send("PONG :tmi.twitch.tv\r\n");
        }
        continue;
      }

      // Comando !play
      if (line.includes(" PRIVMSG #bossfightlivearena :")) {
        const commandIndex = line.indexOf(" PRIVMSG #bossfightlivearena :");
        const messageText = line.slice(commandIndex + " PRIVMSG #bossfightlivearena :".length).trim();
        
        console.log(`📨 Mensagem recebida: "${messageText}"`);

        if (messageText.toLowerCase() === "!play") {
          // Extrai tags
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
    }
  }

  // Adiciona jogador da Twitch
  async addTwitchPlayer(twitchUserId: string, twitchName: string) {
    if (!twitchUserId) {
      return { ok: false, reason: "missing-user-id" };
    }

    // Verifica se já existe
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

    // Posição do jogador
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
      isAI: false,
      isTwitch: true
    };

    this.players.set(playerId, player);

    // Notifica todos
    this.broadcast(JSON.stringify({
      type: "playerJoined",
      player
    }));

    this.broadcastRoomState();

    console.log(`📺 TWITCH !PLAY: ${cleanName} (${playerClass})`);
    
    return { ok: true, player };
  }

  // ============================================
  // CICLO DE VIDA DO SERVIDOR
  // ============================================

  onStart() {
    console.log("🔥 BOSS FIGHT SERVER STARTED");
    this.ensureAI();
    this.scheduleAIAttack();
    this.connectTwitchChat(); // <-- CONECTA AO TWITCH AUTOMATICAMENTE
  }

  onConnect(connection: Connection) {
    this.ensureAI();
    console.log("🟢 PLAYER CONNECTED:", connection.id);
    this.sendRoomState(connection);
  }

  onMessage(connection: Connection, message: WSMessage) {
    try {
      const data: any = JSON.parse(message as string);

      // ... (mantenha o resto do seu código onMessage igual)
      // O código onMessage está muito grande, mas mantenha ele como estava
      
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

// ============================================
// EXPORT PRINCIPAL
// ============================================

export default {
  async fetch(request: Request, env: any) {
    const url = new URL(request.url);

    // Rota para iniciar OAuth
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

    // Callback do OAuth
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

    // PartyKit routing
    const response = await routePartykitRequest(request, { ...env });
    if (response) return response;

    // Assets
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not found", { status: 404 });
  }
};
