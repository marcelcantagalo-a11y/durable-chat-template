import {
  Server,
  type Connection,
  type WSMessage,
  routePartykitRequest
} from "partyserver";

// src/server/index.ts
export class Chat extends Server<Env> {

  static options = {
    hibernate: false
  };

  players = new Map<string, any>();
  gameState: any = null;
  lastSkillClass: any = null;
  botTimer: any = null;

  ensureAI() {

    const aiId = "AI-1";

    // Remove qualquer IA duplicada.
    for (const [id, player] of this.players) {

      if (player.isAI && id !== aiId) {
        this.players.delete(id);
      }

    }

    // Cria a IA caso ela não exista.
    if (!this.players.has(aiId)) {

      this.players.set(aiId, {
        id: aiId,
        name: "Arena AI",
        class: "WARRIOR",
        position: 0,
        level: 1,
        xp: 0,
        maxHp: 150,
        hp: 150,
        totalDamage: 0,
        healing: 0,
        alive: true,
        taunt: false,
        isAI: true
      });

    } else {

      // IMPORTANTÍSSIMO:
      // O Durable Object pode ter uma IA antiga salva como morta.
      // Sempre normaliza a IA existente.
      const ai = this.players.get(aiId);

      if (ai) {

        ai.id = aiId;
        ai.name = "Arena AI";
        ai.class = "WARRIOR";
        ai.maxHp = 150;

        if (
          typeof ai.hp !== "number" ||
          ai.hp <= 0 ||
          ai.alive === false
        ) {
          ai.hp = ai.maxHp;
          ai.alive = true;
        }

        ai.isAI = true;

        if (typeof ai.level !== "number") {
          ai.level = 1;
        }

        if (typeof ai.xp !== "number") {
          ai.xp = 0;
        }

        if (typeof ai.totalDamage !== "number") {
          ai.totalDamage = 0;
        }

        if (typeof ai.healing !== "number") {
          ai.healing = 0;
        }

        if (typeof ai.taunt !== "boolean") {
          ai.taunt = false;
        }

        this.players.set(aiId, ai);

      }

    }

  }

  aiAttack() {

    if (
      !this.gameState ||
      this.gameState.bossHp <= 0
    ) {
      return;
    }

    const humanPlayers = [
      ...this.players.values()
    ].filter(
      player =>
        !player.isAI &&
        player.alive
    );

    // A IA só luta quando existe pelo menos
    // um jogador humano vivo.
    if (humanPlayers.length === 0) {
      return;
    }

    this.ensureAI();

    const ai = this.players.get("AI-1");

    if (!ai) {
      return;
    }

    // Segurança adicional:
    // nunca deixa a IA atacar estando morta.
    if (!ai.alive || ai.hp <= 0) {

      ai.hp = ai.maxHp;
      ai.alive = true;

      this.players.set(
        "AI-1",
        ai
      );

      this.broadcastRoomState();

    }

    let damage =
      Math.floor(
        Math.random() * (80 - 50 + 1)
      ) + 50;

    const critical =
      Math.random() < 0.11;

    if (critical) {
      damage *= 2;
    }

    damage =
      Math.min(
        damage,
        this.gameState.bossHp
      );

    this.gameState.bossHp -=
      damage;

    ai.totalDamage +=
      damage;

    this.players.set(
      "AI-1",
      ai
    );

    this.broadcast(
      JSON.stringify({
        type: "attackResult",
        playerId: "AI-1",
        name: ai.name,
        class: ai.class,
        hit: true,
        damage: damage,
        critical: critical,
        bossHp: this.gameState.bossHp,
        maxBossHp: this.gameState.maxBossHp,
        totalDamage: ai.totalDamage,
        level: ai.level,
        isAI: true,
        alive: ai.alive,
        hp: ai.hp,
        maxHp: ai.maxHp
      })
    );

  }

  getOrderedPlayers() {

    return [
      ...this.players.values()
    ].sort(
      (a, b) =>
        a.position - b.position
    );

  }

  sendRoomState(connection: Connection) {

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

  onStart() {

    console.log(
      "🔥 BOSS FIGHT SERVER STARTED"
    );

    this.ensureAI();

    if (this.botTimer) {
      clearInterval(this.botTimer);
    }

    this.botTimer =
      setInterval(() => {
        this.aiAttack();
      }, 3500);

  }

  onConnect(connection: Connection) {

    this.ensureAI();

    console.log(
      "🟢 PLAYER CONNECTED:",
      connection.id
    );

    this.sendRoomState(connection);

  }

  onMessage(
    connection: Connection,
    message: WSMessage
  ) {

    try {

      const data: any =
        JSON.parse(message as string);

      /* =====================================
         🎮 INICIA A PARTIDA
      ===================================== */

      if (data.type === "initGame") {

        if (this.gameState === null) {

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

      if (data.type === "join") {

        if (
          this.players.has(
            connection.id
          )
        ) {
          return;
        }

        /* =====================================
           CLASS STATS
        ===================================== */

        let maxHp = 100;

        if (data.class === "TANK") {
          maxHp = 220;
        }

        else if (
          data.class === "WARRIOR"
        ) {
          maxHp = 150;
        }

        else if (
          data.class === "ARCHER"
        ) {
          maxHp = 90;
        }

        else if (
          data.class === "MAGE"
        ) {
          maxHp = 85;
        }

        else if (
          data.class === "PRIEST"
        ) {
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

          level: 1,

          xp: 0,

          maxHp:
            maxHp,

          hp:
            maxHp,

          totalDamage: 0,

          healing: 0,

          alive: true,

          taunt: false

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

      if (data.type === "update") {

        const player =
          this.players.get(
            connection.id
          );

        if (player) {

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

      if (data.type === "attack") {

        const player =
          this.players.get(
            connection.id
          );

        if (!player) {
          return;
        }

        if (!this.gameState) {
          return;
        }

        if (
          this.gameState.bossHp <= 0
        ) {
          return;
        }

        if (
          player.alive === false
        ) {
          return;
        }

        /* =====================================
           🎯 ACCURACY
        ===================================== */

        let attackChance;

        if (player.class === "TANK") {
          attackChance = 1.00;
        }

        else if (
          player.class === "WARRIOR"
        ) {
          attackChance = 0.90;
        }

        else if (
          player.class === "ARCHER"
        ) {
          attackChance = 0.80;
        }

        else if (
          player.class === "MAGE"
        ) {
          attackChance = 0.70;
        }

        else {
          attackChance = 1.00;
        }

        /* =====================================
           MISS
        ===================================== */

        if (
          Math.random() >
          attackChance
        ) {

          this.broadcast(
            JSON.stringify({

              type:
                "attackResult",

              playerId:
                player.id,

              name:
                player.name,

              hit: false,

              damage: 0,

              critical: false,

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

        if (player.class === "TANK") {

          minDamage = 25;
          maxDamage = 45;

        }

        else if (
          player.class === "WARRIOR"
        ) {

          minDamage = 50;
          maxDamage = 80;

        }

        else if (
          player.class === "ARCHER"
        ) {

          minDamage = 35;
          maxDamage = 65;

        }

        else if (
          player.class === "MAGE"
        ) {

          minDamage = 80;
          maxDamage = 130;

        }

        else {
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

        if (critical) {
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

            hit: true,

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

      if (data.type === "bossAttack") {

        if (!this.gameState) {
          return;
        }

        if (
          this.gameState.bossHp <= 0
        ) {
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

        if (
          now < nextBossAttackAt
        ) {
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

        if (
          alivePlayers.length === 0
        ) {
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

        if (
          tauntPlayers.length > 0
        ) {

          target =
            tauntPlayers[
              Math.floor(
                Math.random() *
                tauntPlayers.length
              )
            ];

        }

        else {

          const targetWeights: any = {

            "TANK": 40,
            "WARRIOR": 25,
            "ARCHER": 18,
            "MAGE": 12,
            "PRIEST": 5

          };

          const weightedPlayers: any[] = [];

          alivePlayers.forEach(
            player => {

              const weight =
                targetWeights[
                  player.class
                ] || 1;

              for (
                let i = 0;
                i < weight;
                i++
              ) {

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

        if (!target) {
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

        if (
          this.gameState.bossLevel > 20
        ) {

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

        if (
          this.gameState.currentBoss &&
          this.gameState.currentBoss.special
        ) {

          damage =
            Math.floor(
              damage * 1.5
            );

        }

        /* =====================================
           🔥 RAGE
        ===================================== */

        if (
          this.gameState.bossHp <=
          this.gameState.maxBossHp * 0.25
        ) {

          damage =
            Math.floor(
              damage * 1.5
            );

        }

        /* =====================================
           🛡️ TANK REDUCTION
        ===================================== */

        if (
          target.class === "TANK"
        ) {

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

        if (
          target.hp <= 0
        ) {

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

        if (
          this.gameState.bossHp <=
          this.gameState.maxBossHp * 0.25
        ) {

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
              target.alive,

            isAI:
              target.isAI === true

          })
        );

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

      if (data.type === "skill") {

        if (!this.gameState) {
          return;
        }

        if (
          this.gameState.bossHp <= 0
        ) {
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

        if (
          alivePlayers.length === 0
        ) {
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

        if (
          aliveClasses.length === 0
        ) {
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

        if (
          possibleClasses.length === 0
        ) {

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

        if (
          classPlayers.length === 0
        ) {
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
              player.class,

            isAI:
              player.isAI === true

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

      if (data.type === "nextBoss") {

        if (!this.gameState) {
          return;
        }

        /*
          Só aceita o próximo nível.
        */

        const expectedBossLevel =
          this.gameState.bossLevel + 1;

        if (
          Number(data.bossLevel) !==
          expectedBossLevel
        ) {
          return;
        }

        /*
          Impede dois navegadores de
          trocar o boss duas vezes.
        */

        if (
          !data.currentBoss ||
          !data.currentBoss.name ||
          !data.currentBoss.icon ||
          !data.currentBoss.hp
        ) {
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

        // Garante que a IA continue válida
        // durante a troca de boss.
        this.ensureAI();

        console.log(
          "👑 NEXT BOSS OFFICIAL:",
          this.gameState.bossLevel,
          this.gameState.currentBoss.name
        );

        this.broadcastRoomState();

        return;

      }

      /* =====================================
         🔄 RESET BATTLE
      ===================================== */

      if (data.type === "resetGame") {

        /*
          NÃO remove mais os jogadores humanos.
          Apenas restaura todos para o início
          da nova batalha.
        */

        let humanPosition = 0;

        for (
          const [id, player]
          of this.players
        ) {

          if (player.isAI) {
            continue;
          }

          player.level = 1;
          player.xp = 0;
          player.hp = player.maxHp;
          player.alive = true;
          player.totalDamage = 0;
          player.healing = 0;
          player.taunt = false;
          player.position = humanPosition;

          humanPosition++;

          this.players.set(
            id,
            player
          );

        }

        /*
          Garante a existência da IA.
        */

        this.ensureAI();

        const resetBoss =
          data.gameState?.currentBoss ||
          this.gameState?.currentBoss;

        const resetLevel =
          Number(
            data.gameState?.bossLevel
          ) || 1;

        const resetMaxHp =
          Number(
            data.gameState?.maxBossHp
          ) ||
          Number(
            resetBoss?.hp
          ) ||
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

        /*
          Restaura completamente a IA.
        */

        const ai =
          this.players.get("AI-1");

        if (ai) {

          ai.id = "AI-1";
          ai.name = "Arena AI";
          ai.class = "WARRIOR";
          ai.position = humanPosition;
          ai.level = 1;
          ai.xp = 0;
          ai.maxHp = 150;
          ai.hp = 150;
          ai.alive = true;
          ai.taunt = false;
          ai.totalDamage = 0;
          ai.healing = 0;
          ai.isAI = true;

          this.players.set(
            "AI-1",
            ai
          );

        }

        this.lastSkillClass = null;

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

        console.log(
          "🔄 BATTLE RESET - PLAYERS AND AI RESTORED"
        );

        return;

      }

      /* =====================================
         🎮 GAME EVENT
      ===================================== */

      if (data.type === "gameEvent") {

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

      if (data.type === "gameStateUpdate") {

        if (data.gameState) {

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

          this.ensureAI();

          this.broadcastRoomState();

        }

        return;

      }

    }

    catch (error) {

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
  ) {

    const player =
      this.players.get(
        connection.id
      );

    if (player) {

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
  ) {

    return await routePartykitRequest(
      request,
      { ...env }
    ) ||
    env.ASSETS.fetch(
      request
    );

  }

};
