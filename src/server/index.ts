      if(data.type === "resetGame"){
          if(this.resetTimer){
              clearTimeout(this.resetTimer);
              this.resetTimer = null;
          }

          // ============================================================
          // APÓS GAME OVER:
          // TODOS OS HUMANOS SAEM DA ARENA.
          // PARA VOLTAR, PRECISAM USAR !play NOVAMENTE.
          // ============================================================

          for(const [id, player] of this.players){
              if(!player.isAI){
                  this.players.delete(id);
              }
          }

          // ============================================================
          // GARANTE QUE EXISTE SOMENTE UMA IA
          // ============================================================

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

          // ============================================================
          // RESET DA BATALHA
          // ============================================================

          this.gameState = {

              bossLevel: 1,

              currentBoss:
                  resetBoss,

              maxBossHp:
                  resetMaxHp,

              bossHp:
                  resetMaxHp,

              wins: 0,

              nextBossAttackAt: 0

          };

          // ============================================================
          // RECRIA/RESETA A IA
          // ============================================================

          const ai =
              this.players.get("AI-1");

          if(ai){

              const newClass =
                  this.getRandomAIClass();

              const stats =
                  this.getClassStats(newClass);

              ai.id = "AI-1";
              ai.name = "Arena AI";
              ai.position = 0;
              ai.class = newClass;

              ai.maxHp =
                  stats.maxHp;

              ai.hp =
                  stats.maxHp;

              ai.alive = true;
              ai.taunt = false;

              ai.totalDamage = 0;
              ai.healing = 0;

              ai.level = 1;
              ai.xp = 0;

              ai.isAI = true;

              this.players.set(
                  "AI-1",
                  ai
              );

          }else{

              // Se por algum motivo a IA não existir,
              // cria uma nova imediatamente.
              this.ensureAI();

              const newAI =
                  this.players.get("AI-1");

              if(newAI){

                  const newClass =
                      this.getRandomAIClass();

                  const stats =
                      this.getClassStats(newClass);

                  newAI.position = 0;
                  newAI.class = newClass;

                  newAI.maxHp =
                      stats.maxHp;

                  newAI.hp =
                      stats.maxHp;

                  newAI.alive = true;
                  newAI.taunt = false;

                  newAI.totalDamage = 0;
                  newAI.healing = 0;

                  newAI.level = 1;
                  newAI.xp = 0;

                  newAI.isAI = true;

                  this.players.set(
                      "AI-1",
                      newAI
                  );

              }

          }

          // ============================================================
          // REINICIA TIMER DA IA
          // ============================================================

          if(this.botTimer){
              clearTimeout(
                  this.botTimer
              );

              this.botTimer = null;
          }

          this.scheduleAIAttack();

          // ============================================================
          // ENVIA ARENA RESETADA
          // AQUI SÓ DEVE EXISTIR A IA.
          // ============================================================

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
              "🔄 GAME RESET - HUMANOS REMOVIDOS - !PLAY NOVAMENTE"
          );

          return;

      }
