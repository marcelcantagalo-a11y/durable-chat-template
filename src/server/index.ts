import { Server, type Connection, type WSMessage, routePartykitRequest } from "partyserver";

// src/server/index.ts
export class Chat extends Server<Env> {

  static options = {
    hibernate: false
  };

  players = new Map<string, any>();
  gameState: any = null;
  lastSkillClass = null;
  botTimer: any = null;
  resetTimer: any = null;

  static readonly TWITCH_CHANNEL = "bossfightlivearena";
  static readonly TWITCH_REDIRECT_PATH = "/";
  static readonly TWITCH_EVENTSUB_PATH = "/twitch/eventsub";

  getTwitchEventSubSecret() {
    // Usa o Client Secret como segredo do webhook para não exigir uma
    // terceira variável no Cloudflare. O Client Secret deve permanecer secreto.
    return this.env.TWITCH_CLIENT_SECRET;
  }

  async addTwitchPlayer(viewerName: string, twitchUserId: string) {
    const normalizedId = String(twitchUserId || "").trim();
    if(!normalizedId){
      return { ok: false, reason: "missing_user_id" };
    }

    // Não deixa o mesmo viewer entrar duas vezes.
    const existing = [...this.players.values()].find(
      player => player.twitchUserId === normalizedId
    );

    if(existing){
      return { ok: false, reason: "already_in_game", player: existing };
    }

    // Máximo de 8 caracteres, conforme definido para o jogo.
    const cleanName = String(viewerName || "Player")
      .trim()
      .slice(0, 8) || "Player";

    const classes = [
      "TANK",
      "WARRIOR",
      "ARCHER",
      "MAGE",
      "PRIEST"
    ];

    // Máximo de 29 jogadores humanos na arena (1 IA + 29 humanos = 30 total).
    const humanPlayers = [...this.players.values()].filter(
      player => !player.isAI
    );

    if(humanPlayers.length >= 29){
      return { ok: false, reason: "game_full" };
    }

    const playerClass =
      classes[Math.floor(Math.random() * classes.length)];

    const stats = this.getClassStats(playerClass);

    const player = {
      id: `twitch-${normalizedId}`,
      name: cleanName,
      class: playerClass,
      position: this.players.size,
      level: 1,
      xp: 0,
      maxHp: stats.maxHp,
      hp: stats.maxHp,
      totalDamage: 0,
      healing: 0,
      alive: true,
      taunt: false,
      isAI: false,
      twitchUserId: normalizedId,
      twitchUserName: viewerName
    };

    this.players.set(player.id, player);

    this.broadcast(
      JSON.stringify({
        type: "playerJoined",
        player: player
      })
    );

    this.broadcastRoomState();

    console.log(
      "🟣 TWITCH !PLAY:",
      cleanName,
      playerClass,
      normalizedId
    );

    return { ok: true, player };
  }

  async handleTwitchChatMessage(event: any, messageId: string) {
    if(!event){
      return { ok: false, reason: "missing_event" };
    }

    // Twitch pode reenviar notificações; guarda o ID processado no SQLite
    // do Durable Object para evitar duas entradas pelo mesmo !play.
    if(messageId){
      const key = `twitch:event:${messageId}`;
      const alreadyProcessed = await this.ctx.storage.get<boolean>(key);

      if(alreadyProcessed){
        return { ok: true, reason: "duplicate_event" };
      }

      await this.ctx.storage.put(key, true);
    }

    const text = String(event.message?.text || "")
      .trim()
      .toLowerCase();

    if(text !== "!play"){
      return { ok: true, reason: "not_play" };
    }

    const broadcasterLogin = String(
      event.broadcaster_user_login || ""
    ).toLowerCase();

    if(
      broadcasterLogin &&
      broadcasterLogin !== Chat.TWITCH_CHANNEL
    ){
      return { ok: false, reason: "wrong_channel" };
    }

    const viewerName =
      event.chatter_user_name ||
      event.chatter_user_login ||
      "Player";

    const twitchUserId =
      event.chatter_user_id ||
      event.chatter_user_login ||
      viewerName;

    return await this.addTwitchPlayer(
      viewerName,
      twitchUserId
    );
  }

  async twitchOAuthCallback(code: string, redirectUri: string) {
    const clientId = this.env.TWITCH_CLIENT_ID;
    const clientSecret = this.env.TWITCH_CLIENT_SECRET;

    if(!clientId || !clientSecret){
      return {
        ok: false,
        error: "Twitch não configurado. Verifique TWITCH_CLIENT_ID e TWITCH_CLIENT_SECRET."
      };
    }

    const tokenResponse = await fetch(
      "https://id.twitch.tv/oauth2/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code: code,
          grant_type: "authorization_code",
          redirect_uri: redirectUri
        })
      }
    );

    const tokenData: any = await tokenResponse.json();

    if(!tokenResponse.ok || !tokenData.access_token){
      console.error("❌ TWITCH TOKEN ERROR:", tokenData);
      return {
        ok: false,
        error: "A Twitch recusou o código de autorização.",
        details: tokenData
      };
    }

    const userResponse = await fetch(
      "https://api.twitch.tv/helix/users",
      {
        headers: {
          "Authorization": `Bearer ${tokenData.access_token}`,
          "Client-Id": clientId
        }
      }
    );

    const userData: any = await userResponse.json();
    const twitchUser = userData?.data?.[0];

    if(!userResponse.ok || !twitchUser){
      console.error("❌ TWITCH USER ERROR:", userData);
      return {
        ok: false,
        error: "Não foi possível identificar a conta da Twitch."
      };
    }

    if(
      String(twitchUser.login || "").toLowerCase() !==
      Chat.TWITCH_CHANNEL
    ){
      return {
        ok: false,
        error: `Autorize usando a conta ${Chat.TWITCH_CHANNEL}.`
      };
    }

    await this.ctx.storage.put(
      "twitch:access_token",
      tokenData.access_token
    );

    await this.ctx.storage.put(
      "twitch:refresh_token",
      tokenData.refresh_token || ""
    );

    await this.ctx.storage.put(
      "twitch:user_id",
      twitchUser.id
    );

    await this.ctx.storage.put(
      "twitch:user_login",
      twitchUser.login
    );

    const appTokenResponse = await fetch(
      "https://id.twitch.tv/oauth2/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "client_credentials"
        })
      }
    );

    const appTokenData: any = await appTokenResponse.json();

    if(!appTokenResponse.ok || !appTokenData.access_token){
      console.error("❌ TWITCH APP TOKEN ERROR:", appTokenData);
      return {
        ok: false,
        error: "Não foi possível criar o token da aplicação Twitch.",
        details: appTokenData
      };
    }

    const callbackUrl =
      new URL(Chat.TWITCH_EVENTSUB_PATH, redirectUri).toString();

    const subscriptionResponse = await fetch(
      "https://api.twitch.tv/helix/eventsub/subscriptions",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${appTokenData.access_token}`,
          "Client-Id": clientId,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          type: "channel.chat.message",
          version: "1",
          condition: {
            broadcaster_user_id: twitchUser.id,
            user_id: twitchUser.id
          },
          transport: {
            method: "webhook",
            callback: callbackUrl,
            secret: this.getTwitchEventSubSecret()
          }
        })
      }
    );

    const subscriptionData: any =
      await subscriptionResponse.json();

    if(
      !subscriptionResponse.ok &&
      !String(subscriptionData?.message || "")
        .toLowerCase()
        .includes("subscription")
    ){
      console.error(
        "❌ TWITCH EVENTSUB ERROR:",
        subscriptionData
      );

      return {
        ok: false,
        error: "A Twitch recusou a assinatura do chat.",
        details: subscriptionData
      };
    }

    await this.ctx.storage.put(
      "twitch:connected",
      true
    );

    console.log(
      "🟣 TWITCH CONNECTED:",
      twitchUser.login,
      subscriptionData
    );

    return {
      ok: true,
      user: twitchUser,
      subscription: subscriptionData
    };
  }

  async verifyTwitchEventSub(
    messageId: string,
    timestamp: string,
    body: string,
    signature: string
  ) {
    const secret = this.getTwitchEventSubSecret();

    if(!secret){
      return false;
    }

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const signed = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(messageId + timestamp + body)
    );

    const bytes = new Uint8Array(signed);
    let hex = "";

    for(const byte of bytes){
      hex += byte.toString(16).padStart(2, "0");
    }

    const expected = `sha256=${hex}`;

    if(expected.length !== signature.length){
      return false;
    }

    let difference = 0;

    for(let i = 0; i < expected.length; i++){
      difference |=
        expected.charCodeAt(i) ^ signature.charCodeAt(i);
    }

    return difference === 0;
  }

  getClassStats(className: string) {
    const stats: Record<string, any> = {
      TANK: {
        maxHp: 220,
        minDamage: 25,
        maxDamage: 45,
        speed: 3000,
        accuracy: 1.00
      },
      WARRIOR: {
        maxHp: 150,
        minDamage: 50,
        maxDamage: 80,
        speed: 2500,
        accuracy: 0.90
      },
      ARCHER: {
        maxHp: 90,
        minDamage: 35,
        maxDamage: 65,
        speed: 1000,
        accuracy: 0.80
      },
      MAGE: {
        maxHp: 85,
        minDamage: 80,
        maxDamage: 130,
        speed: 2800,
        accuracy: 0.70
      },
      PRIEST: {
        maxHp: 80,
        minDamage: 0,
        maxDamage: 0,
        speed: 4000,
        accuracy: 1.00
      }
    };

    return stats[className] || stats.WARRIOR;
  }

  getRandomAIClass() {
    const classes = [
      "TANK",
      "WARRIOR",
      "ARCHER",
      "MAGE",
      "PRIEST"
    ];

    return classes[
      Math.floor(Math.random() * classes.length)
    ];
  }

  ensureAI() {
    const aiId = "AI-1";

    for(const [id, player] of this.players){
      if(player.isAI && id !== aiId){
        this.players.delete(id);
      }
    }

    let ai = this.players.get(aiId);

    if(!ai){
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
      return;
    }

    const validClasses = [
      "TANK",
      "WARRIOR",
      "ARCHER",
      "MAGE",
      "PRIEST"
    ];

    if(!validClasses.includes(ai.class)){
      ai.class = this.getRandomAIClass();
    }

    const stats = this.getClassStats(ai.class);

    ai.id = aiId;
    ai.name = "Arena AI";
    ai.isAI = true;
    ai.maxHp = stats.maxHp;

    // IMPORTANTE: não revive a IA aqui.
    // Se ela morreu, permanece morta até o reset da batalha.
    if(typeof ai.hp !== "number"){
      ai.hp = ai.alive ? stats.maxHp : 0;
    }

    this.players.set(aiId, ai);
  }

  scheduleAIAttack(delay?: number) {
    if(this.botTimer){
      clearTimeout(this.botTimer);
      this.botTimer = null;
    }

    const ai = this.players.get("AI-1");
    const stats = ai
      ? this.getClassStats(ai.class)
      : this.getClassStats("WARRIOR");

    const wait =
      typeof delay === "number"
        ? delay
        : stats.speed;

    this.botTimer = setTimeout(() => {
      this.botTimer = null;
      this.aiAttack();
      this.scheduleAIAttack();
    }, wait);
  }

  aiAttack() {
    if(!this.gameState || this.gameState.bossHp <= 0){
      return;
    }

    const livingPlayers = [
      ...this.players.values()
    ].filter(
      player => player.alive
    );

    if(livingPlayers.length === 0){
      return;
    }

    this.ensureAI();

    const ai = this.players.get("AI-1");

    if(!ai){
      return;
    }

    // IA morta NÃO ataca e NÃO revive.
    if(!ai.alive || ai.hp <= 0){
      return;
    }

    const stats = this.getClassStats(ai.class);

    // Priest é suporte: cura um jogador vivo que esteja ferido.
    if(ai.class === "PRIEST"){
      const damagedPlayers = livingPlayers.filter(
        player => !player.isAI && player.hp < player.maxHp
      );

      if(damagedPlayers.length === 0){
        return;
      }

      damagedPlayers.sort(
        (a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp)
      );

      const target = damagedPlayers[0];

      let heal =
        Math.floor(Math.random() * 16) + 15;

      heal += ai.level * 2;

      const healingPower =
        typeof ai.healingPower === "number"
          ? ai.healingPower
          : 1;

      heal = Math.floor(heal * healingPower);
      heal = Math.min(heal, target.maxHp - target.hp);

      if(heal <= 0){
        return;
      }

      target.hp += heal;
      ai.healing += heal;

      this.players.set(target.id, target);
      this.players.set(ai.id, ai);

      this.broadcast(
        JSON.stringify({
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
        })
      );

      return;
    }

    // As demais classes usam exatamente a faixa e precisão da classe.
    if(Math.random() > stats.accuracy){
      this.broadcast(
        JSON.stringify({
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
        })
      );
      return;
    }

    let damage =
      Math.floor(
        Math.random() *
        (stats.maxDamage - stats.minDamage + 1)
      ) + stats.minDamage;

    damage =
      Math.floor(
        damage *
        (
          1 +
          (ai.level - 1) * 0.08
        )
      );

    const critical = Math.random() < 0.11;

    if(critical){
      damage *= 2;
    }

    damage = Math.min(
      damage,
      this.gameState.bossHp
    );

    this.gameState.bossHp -= damage;
    ai.totalDamage += damage;

    this.players.set(ai.id, ai);

    this.broadcast(
      JSON.stringify({
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
      })
    );
  }

  getOrderedPlayers() {
    return [
      ...this.players.values()
    ].sort(
      (a, b) => a.position - b.position
    );
  }

  sendRoomState(connection) {
    connection.send(
      JSON.stringify({
        type: "roomState",
        players: this.getOrderedPlayers(),
        gameState: this.gameState
      })
    );
  }

  broadcastRoomState() {
    this.broadcast(
      JSON.stringify({
        type: "roomState",
        players: this.getOrderedPlayers(),
        gameState: this.gameState
      })
    );
  }

  scheduleGameReset() {
    if(this.resetTimer){ return; }
    this.resetTimer = setTimeout(() => {
      this.resetTimer = null;
      this.ensureAI();
      for(const [id, player] of this.players){
        if(player.isAI) continue;
        const stats = this.getClassStats(player.class);
        player.maxHp = stats.maxHp; player.hp = stats.maxHp; player.alive = true;
        player.taunt = false; player.totalDamage = 0; player.healing = 0;
        player.level = 1; player.xp = 0;
        this.players.set(id, player);
      }
      const ai = this.players.get("AI-1");
      if(ai){
        const newClass = this.getRandomAIClass();
        const stats = this.getClassStats(newClass);
        ai.position = 0; ai.class = newClass; ai.maxHp = stats.maxHp; ai.hp = stats.maxHp;
        ai.alive = true; ai.taunt = false; ai.totalDamage = 0; ai.healing = 0;
        ai.level = 1; ai.xp = 0; ai.isAI = true;
        this.players.set("AI-1", ai);
      }
      const boss = this.gameState?.currentBoss || {name:"THE DEMON", icon:"👹", hp:10000};
      const hp = Number(boss.hp) || 10000;
      this.gameState = {bossLevel:1, currentBoss:boss, maxBossHp:hp, bossHp:hp, wins:0, nextBossAttackAt:0};
      if(this.botTimer){ clearTimeout(this.botTimer); this.botTimer = null; }
      this.scheduleAIAttack();
      this.broadcast(JSON.stringify({type:"roomState", reset:true, players:this.getOrderedPlayers(), gameState:this.gameState}));
      console.log("🔄 AUTOMATIC GAME RESET");
    },10000);
  }

  onStart() {
    console.log(
      "🔥 BOSS FIGHT SERVER STARTED"
    );

    this.ensureAI();

    if(this.botTimer){
      clearTimeout(this.botTimer);
      this.botTimer = null;
    }

    this.scheduleAIAttack();
  }

  onConnect(connection: Connection) {
    this.ensureAI();

    console.log(
      "🟢 PLAYER CONNECTED:",
      connection.id
    );

    this.sendRoomState(connection);
  }

  onMessage(connection: Connection, message: WSMessage) {

    try {

        const data: any =
            JSON.parse(message as string);



        /* =====================================
           🎮 INICIA A PARTIDA
        ===================================== */

        if(data.type === "initGame"){

            if(this.gameState === null){

                this.gameState = {

                    bossLevel:
                        data.gameState.bossLevel,

                    currentBoss:
                        data.gameState.currentBoss,

                    maxBossHp:
                        data.gameState.maxBossHp,

                    bossHp:
                        data.gameState.bossHp,

                    wins:
                        data.gameState.wins,

                    nextBossAttackAt:
                        0

                };


                console.log(

                    "🎮 GAME CREATED:",

                    this.gameState

                );

            }


            this.ensureAI();

            this.broadcastRoomState();


            return;

        }



        /* =====================================
           PLAYER ENTERS THE GAME
        ===================================== */

        if(data.type === "join"){

            if(

                this.players.has(

                    connection.id

                )

            ){

                return;

            }



            /* =====================================
               CLASS STATS
            ===================================== */

            let maxHp = 100;


            if(data.class === "TANK"){

                maxHp = 220;

            }

            else if(

                data.class === "WARRIOR"

            ){

                maxHp = 150;

            }

            else if(

                data.class === "ARCHER"

            ){

                maxHp = 90;

            }

            else if(

                data.class === "MAGE"

            ){

                maxHp = 85;

            }

            else if(

                data.class === "PRIEST"

            ){

                maxHp = 80;

            }



            const player = {

                id:
                    connection.id,

                name:
                    data.name || "Player",

                class:
                    data.class || "WARRIOR",

                position:
                    this.players.size,

                level:1,

                xp:0,

                maxHp:
                    maxHp,

                hp:
                    maxHp,

                totalDamage:0,

                healing:0,

                alive:true,

                taunt:false

            };


            this.players.set(

                connection.id,

                player

            );


            /*

               Avisa somente os outros.

            */

            this.broadcast(

                JSON.stringify({

                    type:
                        "playerJoined",

                    player:
                        player

                }),

                [connection.id]

            );


            /*

               Envia a sala completa para
               quem acabou de entrar.

            */

            this.sendRoomState(

                connection

            );


            console.log(

                "⚔️ PLAYER JOINED:",

                player.name,

                player.class,

                "POSITION:",

                player.position

            );


            return;

        }



        /* =====================================
           PLAYER UPDATE
        ===================================== */

        if(data.type === "update"){

            const player =

                this.players.get(

                    connection.id

                );


            if(player){

                Object.assign(

                    player,

                    data.player

                );


                this.players.set(

                    connection.id,

                    player

                );


                this.broadcast(

                    JSON.stringify({

                        type:
                            "playerUpdated",

                        player:
                            player

                    })

                );

            }


            return;

        }



        /* =====================================
           ⚔️ PLAYER ATTACK
        ===================================== */

        if(data.type === "attack"){

            const player =

                this.players.get(

                    connection.id

                );


            if(!player){

                return;

            }


            if(!this.gameState){

                return;

            }


            if(

                this.gameState.bossHp <= 0

            ){

                return;

            }


            if(player.alive === false){

                return;

            }



            /* =====================================
               🎯 ACCURACY
            ===================================== */

            let attackChance;


            if(player.class === "TANK"){

                attackChance = 1.00;

            }

            else if(

                player.class === "WARRIOR"

            ){

                attackChance = 0.90;

            }

            else if(

                player.class === "ARCHER"

            ){

                attackChance = 0.80;

            }

            else if(

                player.class === "MAGE"

            ){

                attackChance = 0.70;

            }

            else{

                attackChance = 1.00;

            }



            /* =====================================
               MISS
            ===================================== */

            if(

                Math.random() >

                attackChance

            ){

                this.broadcast(

                    JSON.stringify({

                        type:
                            "attackResult",

                        playerId:
                            player.id,

                        name:
                            player.name,

                        hit:false,

                        damage:0,

                        critical:false,

                        bossHp:
                            this.gameState.bossHp,

                        maxBossHp:
                            this.gameState.maxBossHp

                    })

                );


                return;

            }



            /* =====================================
               💥 DAMAGE
            ===================================== */

            let minDamage = 0;

            let maxDamage = 0;


            if(player.class === "TANK"){

                minDamage = 25;

                maxDamage = 45;

            }

            else if(

                player.class === "WARRIOR"

            ){

                minDamage = 50;

                maxDamage = 80;

            }

            else if(

                player.class === "ARCHER"

            ){

                minDamage = 35;

                maxDamage = 65;

            }

            else if(

                player.class === "MAGE"

            ){

                minDamage = 80;

                maxDamage = 130;

            }

            else{

                return;

            }



            let damage =

                Math.floor(

                    Math.random() *

                    (

                        maxDamage -

                        minDamage +

                        1

                    )

                ) +

                minDamage;


            damage =

                Math.floor(

                    damage *

                    (

                        1 +

                        (

                            player.level - 1

                        ) * 0.08

                    )

                );


            const critical =

                Math.random() < 0.11;


            if(critical){

                damage *= 2;

            }


            damage =

                Math.min(

                    damage,

                    this.gameState.bossHp

                );


            this.gameState.bossHp -=

                damage;


            player.totalDamage +=

                damage;


            this.players.set(

                connection.id,

                player

            );


            this.broadcast(

                JSON.stringify({

                    type:
                        "attackResult",

                    playerId:
                        player.id,

                    name:
                        player.name,

                    class:
                        player.class,

                    hit:true,

                    damage:
                        damage,

                    critical:
                        critical,

                    bossHp:
                        this.gameState.bossHp,

                    maxBossHp:
                        this.gameState.maxBossHp,

                    totalDamage:
                        player.totalDamage,

                    level:
                        player.level

                })

            );


            return;

        }



        /* =====================================
           👹 BOSS ATTACK
        ===================================== */

        if(data.type === "bossAttack"){

            if(!this.gameState){

                return;

            }


            if(

                this.gameState.bossHp <= 0

            ){

                return;

            }



            /* =================================
               ⏱️ SERVER ATTACK COOLDOWN
            ================================= */

            const now =
                Date.now();


            const nextBossAttackAt =

                Number(

                    this.gameState.nextBossAttackAt || 0

                );


            if(

                now < nextBossAttackAt

            ){

                return;

            }



            const alivePlayers =

                [

                    ...this.players.values()

                ]

                .filter(

                    player =>

                        player.alive

                );


            if(

                alivePlayers.length === 0

            ){

                return;

            }



            /* =====================================
               🛡️ TAUNT
            ===================================== */

            const tauntPlayers =

                alivePlayers.filter(

                    player =>

                        player.taunt === true

                );


            let target;


            if(

                tauntPlayers.length > 0

            ){

                target =

                    tauntPlayers[

                        Math.floor(

                            Math.random() *

                            tauntPlayers.length

                        )

                    ];

            }

            else{

                const targetWeights = {

                    "TANK":40,

                    "WARRIOR":25,

                    "ARCHER":18,

                    "MAGE":12,

                    "PRIEST":5

                };


                const weightedPlayers = [];


                alivePlayers.forEach(

                    player => {

                        const weight =

                            targetWeights[

                                player.class

                            ] || 1;


                        for(

                            let i = 0;

                            i < weight;

                            i++

                        ){

                            weightedPlayers.push(

                                player

                            );

                        }

                    }

                );


                target =

                    weightedPlayers[

                        Math.floor(

                            Math.random() *

                            weightedPlayers.length

                        )

                    ];

            }


            if(!target){

                return;

            }



            /* =====================================
               👹 BOSS SPELLS
            ===================================== */

            const bossSpells = [

                [

                    "💥",

                    "DEMON STRIKE",

                    45

                ],

                [

                    "🔥",

                    "HELLFIRE",

                    55

                ],

                [

                    "⚡",

                    "DARK LIGHTNING",

                    60

                ],

                [

                    "👻",

                    "SOUL RIP",

                    50

                ]

            ];


            const spell =

                bossSpells[

                    Math.floor(

                        Math.random() *

                        bossSpells.length

                    )

                ];



            /* =====================================
               💥 BASE DAMAGE
            ===================================== */

            let damage =

                Math.floor(

                    spell[2] *

                    (

                        1 +

                        this.gameState.bossLevel *

                        0.10

                    )

                );



            /* =====================================
               🔥 LEVEL 20+
            ===================================== */

            if(

                this.gameState.bossLevel > 20

            ){

                damage =

                    Math.floor(

                        damage *

                        (

                            1 +

                            (

                                this.gameState.bossLevel -

                                20

                            ) *

                            0.05

                        )

                    );

            }



            /* =====================================
               👑 SPECIAL BOSS
            ===================================== */

            if(

                this.gameState.currentBoss &&

                this.gameState.currentBoss.special

            ){

                damage =

                    Math.floor(

                        damage * 1.5

                    );

            }



            /* =====================================
               🔥 RAGE
            ===================================== */

            if(

                this.gameState.bossHp <=

                this.gameState.maxBossHp * 0.25

            ){

                damage =

                    Math.floor(

                        damage * 1.5

                    );

            }



            /* =====================================
               🛡️ TANK REDUCTION
            ===================================== */

            if(

                target.class === "TANK"

            ){

                damage =

                    Math.floor(

                        damage * 0.65

                    );

            }


            damage =

                Math.min(

                    damage,

                    target.hp

                );


            target.hp -=

                damage;


            if(

                target.hp <= 0

            ){

                target.hp = 0;

                target.alive = false;

            }


            this.players.set(

                target.id,

                target

            );



            /* =====================================
               ⏱️ CALCULATE NEXT BOSS ATTACK
            ===================================== */

            let attackSpeed =

                5000 -

                (

                    this.gameState.bossLevel - 1

                ) *

                40;


            attackSpeed =

                Math.max(

                    2500,

                    attackSpeed

                );


            if(

                this.gameState.bossHp <=

                this.gameState.maxBossHp * 0.25

            ){

                attackSpeed =

                    Math.floor(

                        attackSpeed * 0.70

                    );

            }


            this.gameState.nextBossAttackAt =

                Date.now() +

                attackSpeed;



            /* =====================================
               📡 SEND RESULT TO EVERYONE
            ===================================== */

            this.broadcast(

                JSON.stringify({

                    type:
                        "bossAttackResult",

                    targetId:
                        target.id,

                    targetName:
                        target.name,

                    targetClass:
                        target.class,

                    spellIcon:
                        spell[0],

                    spellName:
                        spell[1],

                    damage:
                        damage,

                    hp:
                        target.hp,

                    maxHp:
                        target.maxHp,

                    alive:
                        target.alive

                })

            );


            const aliveAfterBossAttack = [...this.players.values()].filter(player => player.alive);

            if(aliveAfterBossAttack.length === 0){
                this.scheduleGameReset();
            }

            console.log(

                "👹 BOSS ATTACK:",

                target.name,

                "-",

                damage,

                "HP"

            );


            return;

        }



        /* =====================================
           ✨ PLAYER SKILL
        ===================================== */

        if(data.type === "skill"){

            if(!this.gameState){

                return;

            }


            if(

                this.gameState.bossHp <= 0

            ){

                return;

            }


            const alivePlayers =

                [

                    ...this.players.values()

                ]

                .filter(

                    player =>

                        player.alive

                );


            if(alivePlayers.length === 0){

                return;

            }


            const availableClasses = [

                "TANK",
                "WARRIOR",
                "ARCHER",
                "MAGE",
                "PRIEST"

            ];


            const aliveClasses =

                availableClasses.filter(

                    className =>

                        alivePlayers.some(

                            player =>

                                player.class ===
                                className

                        )

                );


            if(aliveClasses.length === 0){

                return;

            }


            /*
               Evita repetir a mesma classe
               duas vezes seguidas.
            */

            let possibleClasses =

                aliveClasses.filter(

                    className =>

                        className !==
                        this.lastSkillClass

                );


            if(possibleClasses.length === 0){

                possibleClasses =

                    aliveClasses;

            }


            const selectedClass =

                possibleClasses[

                    Math.floor(

                        Math.random() *

                        possibleClasses.length

                    )

                ];


            this.lastSkillClass =

                selectedClass;


            /*
               Escolhe um jogador vivo
               dessa classe.
            */

            const classPlayers =

                alivePlayers.filter(

                    player =>

                        player.class ===
                        selectedClass

                );


            if(classPlayers.length === 0){

                return;

            }


            const player =

                classPlayers[

                    Math.floor(

                        Math.random() *

                        classPlayers.length

                    )

                ];


            /*
               Envia a decisão oficial
               para todos os navegadores.
            */

            this.broadcast(

                JSON.stringify({

                    type:
                        "skillResult",

                    playerId:
                        player.id,

                    playerName:
                        player.name,

                    playerClass:
                        player.class

                })

            );


            console.log(

                "✨ SKILL OFFICIAL:",

                player.name,

                player.class

            );


            return;

        }



        /* =====================================
           👑 NEXT BOSS
        ===================================== */

        if(data.type === "nextBoss"){

            if(!this.gameState){

                return;

            }


            /*
               Só aceita o próximo nível.
            */

            const expectedBossLevel =

                this.gameState.bossLevel + 1;


            if(

                Number(data.bossLevel) !==

                expectedBossLevel

            ){

                return;

            }


            /*
               Impede dois navegadores de
               trocar o boss duas vezes.
            */

            if(

                !data.currentBoss ||

                !data.currentBoss.name ||

                !data.currentBoss.icon ||

                !data.currentBoss.hp

            ){

                return;

            }


            this.gameState = {

                bossLevel:

                    Number(data.bossLevel),

                currentBoss:

                    data.currentBoss,

                maxBossHp:

                    Number(data.maxBossHp) ||

                    Number(data.currentBoss.hp),

                bossHp:

                    Number(data.bossHp) ||

                    Number(data.currentBoss.hp),

                wins:

                    this.gameState.wins,

                nextBossAttackAt:

                    0

            };


            console.log(

                "👑 NEXT BOSS OFFICIAL:",

                this.gameState.bossLevel,

                this.gameState.currentBoss.name

            );


            this.broadcastRoomState();


            return;

        }



        /* =====================================
           🔄 RESET BATTLE + KEEP ONE AI
        ===================================== */

        if(data.type === "resetGame"){
            if(this.resetTimer){
                clearTimeout(this.resetTimer);
                this.resetTimer = null;
            }


            this.ensureAI();

            // Reinicia todos os jogadores existentes.
            // A IA recebe uma nova classe aleatória abaixo.
            for(const [id, player] of this.players){
                if(player.isAI){
                    continue;
                }

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

            const resetBoss =
                data.gameState?.currentBoss ||
                this.gameState?.currentBoss;

            const resetLevel =
                Number(data.gameState?.bossLevel) || 1;

            const resetMaxHp =
                Number(data.gameState?.maxBossHp) ||
                Number(resetBoss?.hp) ||
                10000;

            this.gameState = {

                bossLevel:
                    resetLevel,

                currentBoss:
                    resetBoss,

                maxBossHp:
                    resetMaxHp,

                bossHp:
                    resetMaxHp,

                wins:
                    0,

                nextBossAttackAt:
                    0

            };

            const ai =
                this.players.get("AI-1");

            if(ai){
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

            if(this.botTimer){
                clearTimeout(this.botTimer);
                this.botTimer = null;
            }

            this.scheduleAIAttack();

            this.broadcast(
                JSON.stringify({

                    type:
                        "roomState",

                    reset:
                        true,

                    players:
                        this.getOrderedPlayers(),

                    gameState:
                        this.gameState

                })
            );

            return;

        }



        /* =====================================
           🎮 GAME EVENT
        ===================================== */

        if(data.type === "gameEvent"){

            this.broadcast(

                JSON.stringify({

                    type:
                        "gameEvent",

                    event:
                        data.event

                })

            );


            return;

        }



        /* =====================================
           🎯 ATUALIZA ESTADO DO BOSS
        ===================================== */

        if(data.type === "gameStateUpdate"){

            if(data.gameState){

                this.gameState = {

                    bossLevel:
                        data.gameState.bossLevel,

                    currentBoss:
                        data.gameState.currentBoss,

                    maxBossHp:
                        data.gameState.maxBossHp,

                    bossHp:
                        data.gameState.bossHp,

                    wins:
                        data.gameState.wins,

                    nextBossAttackAt:
                        this.gameState?.nextBossAttackAt || 0

                };


                this.broadcastRoomState();

            }


            return;

        }

    }

        catch(error){

        console.error(

            "❌ MESSAGE ERROR:",

            error

        );

    }

}

  onClose(
    connection: Connection,
    code: number,
    reason: string,
    wasClean: boolean
  ){

    const player =
      this.players.get(
        connection.id
      );

    if(player){

      this.players.delete(
        connection.id
      );

      this.broadcast(
        JSON.stringify({
          type:
            "playerLeft",
          playerId:
            connection.id
        })
      );

      console.log(
        "🔴 PLAYER LEFT:",
        player.name
      );

    }

  }

}

export default {
  async fetch(
    request,
    env
  ){
    const url = new URL(request.url);

    // ============================================================
    // TWITCH OAUTH
    // ============================================================

    if(
      request.method === "GET" &&
      url.pathname === "/twitch/login"
    ){
      const clientId = env.TWITCH_CLIENT_ID;

      if(!clientId || !env.TWITCH_CLIENT_SECRET){
        return new Response(
          "Twitch não configurado. Verifique TWITCH_CLIENT_ID e TWITCH_CLIENT_SECRET.",
          { status: 500 }
        );
      }

      const redirectUri =
        `${url.origin}${Chat.TWITCH_REDIRECT_PATH}`;

      const twitchUrl =
        new URL("https://id.twitch.tv/oauth2/authorize");

      twitchUrl.searchParams.set(
        "client_id",
        clientId
      );

      twitchUrl.searchParams.set(
        "redirect_uri",
        redirectUri
      );

      twitchUrl.searchParams.set(
        "response_type",
        "code"
      );

      twitchUrl.searchParams.set(
        "scope",
        "user:read:chat user:bot channel:bot"
      );

      return Response.redirect(
        twitchUrl.toString(),
        302
      );
    }

    // ============================================================
    // TWITCH OAUTH CALLBACK
    // ============================================================

    if(
      request.method === "GET" &&
      url.pathname === "/" &&
      url.searchParams.has("code")
    ){
      const code =
        url.searchParams.get("code");

      if(!code){
        return new Response(
          "Código OAuth ausente.",
          { status: 400 }
        );
      }

      try{
        const id =
          env.Chat.idFromName("bossfight");

        const stub =
          env.Chat.get(id);

        const result =
          await stub.twitchOAuthCallback(
            code,
            `${url.origin}${Chat.TWITCH_REDIRECT_PATH}`
          );

        if(!result.ok){
          return new Response(
            `Twitch: ${result.error}`,
            {
              status: 400,
              headers: {
                "Content-Type": "text/plain; charset=utf-8"
              }
            }
          );
        }

        return new Response(
          "Twitch conectado com sucesso! Agora o comando !play está habilitado no chat.",
          {
            status: 200,
            headers: {
              "Content-Type": "text/plain; charset=utf-8"
            }
          }
        );
      }catch(error){
        console.error(
          "❌ TWITCH OAUTH CALLBACK ERROR:",
          error
        );

        return new Response(
          "Erro ao conectar a Twitch. Veja os logs do Worker.",
          { status: 500 }
        );
      }
    }

    // ============================================================
    // TWITCH EVENTSUB WEBHOOK
    // ============================================================

    if(
      url.pathname === Chat.TWITCH_EVENTSUB_PATH
    ){
      if(request.method !== "POST"){
        return new Response(
          "Method Not Allowed",
          { status: 405 }
        );
      }

      const messageId =
        request.headers.get(
          "Twitch-Eventsub-Message-Id"
        ) || "";

      const timestamp =
        request.headers.get(
          "Twitch-Eventsub-Message-Timestamp"
        ) || "";

      const signature =
        request.headers.get(
          "Twitch-Eventsub-Message-Signature"
        ) || "";

      const messageType =
        request.headers.get(
          "Twitch-Eventsub-Message-Type"
        ) || "";

      const body = await request.text();

      try{
        const id =
          env.Chat.idFromName("bossfight");

        const stub =
          env.Chat.get(id);

        const valid =
          await stub.verifyTwitchEventSub(
            messageId,
            timestamp,
            body,
            signature
          );

        if(!valid){
          return new Response(
            "Invalid signature",
            { status: 403 }
          );
        }

        const payload: any =
          JSON.parse(body);

        if(messageType === "webhook_callback_verification"){
          return new Response(
            payload.challenge || "",
            {
              status: 200,
              headers: {
                "Content-Type": "text/plain; charset=utf-8"
              }
            }
          );
        }

        if(messageType === "notification"){
          if(
            payload.subscription?.type ===
            "channel.chat.message"
          ){
            await stub.handleTwitchChatMessage(
              payload.event,
              messageId
            );
          }

          return new Response(
            "OK",
            { status: 200 }
          );
        }

        if(messageType === "revocation"){
          console.warn(
            "⚠️ TWITCH EVENTSUB REVOGADO:",
            payload
          );

          return new Response(
            "OK",
            { status: 200 }
          );
        }

        return new Response(
          "OK",
          { status: 200 }
        );
      }catch(error){
        console.error(
          "❌ TWITCH EVENTSUB ERROR:",
          error
        );

        return new Response(
          "Webhook error",
          { status: 500 }
        );
      }
    }

    return await routePartykitRequest(
      request,
      { ...env }
    ) ||
    env.ASSETS.fetch(
      request
    );
  }
};



//# sourceMappingURL=index.js.map
