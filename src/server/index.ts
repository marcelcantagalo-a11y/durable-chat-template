if(data.type === "resetGame"){
    if(this.resetTimer){
        clearTimeout(this.resetTimer);
        this.resetTimer = null;
    }

    // Após o GAME OVER, todos os jogadores humanos saem.
    // Para voltar, precisam usar !play novamente.
    for(const [id, player] of this.players){
        if(!player.isAI){
            this.players.delete(id);
        }
    }

    // Garante que existe somente a IA.
    this.ensureAI();

    const resetBoss =
        data.gameState?.currentBoss ||
        this.gameState?.currentBoss ||
        {
            name: "THE DEMON",
            icon: "👹",
            hp: 10000
        };

    const resetMaxHp =
        Number(data.gameState?.maxBossHp) ||
        Number(resetBoss?.hp) ||
        10000;

    this.gameState = {
        bossLevel: 1,
        currentBoss: resetBoss,
        maxBossHp: resetMaxHp,
        bossHp: resetMaxHp,
        wins: 0,
        nextBossAttackAt: 0
    };

    // Reseta a IA com uma nova classe.
    const ai = this.players.get("AI-1");

    if(ai){
        const newClass = this.getRandomAIClass();
        const stats = this.getClassStats(newClass);

        ai.id = "AI-1";
        ai.name = "Arena AI";
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
            type: "roomState",
            reset: true,
            players: this.getOrderedPlayers(),
            gameState: this.gameState
        })
    );

    console.log(
        "🔄 GAME RESET - HUMANOS REMOVIDOS - !PLAY NOVAMENTE"
    );

    return;
}
