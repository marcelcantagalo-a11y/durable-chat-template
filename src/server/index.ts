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

    if(!this.getClassStats(ai.class)){
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

    const humanPlayers = [
      ...this.players.values()
    ].filter(
      player => !player.isAI && player.alive
    );

    if(humanPlayers.length === 0){
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
      const damagedPlayers = humanPlayers.filter(
        player => player.hp < player.maxHp
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

            for(const [id, player] of this.players){

                if(!player.isAI){
                    this.players.delete(id);
                }

            }

            this.ensureAI();

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
