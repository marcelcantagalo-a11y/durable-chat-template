import { createRoot } from "react-dom/client";
import { usePartySocket } from "partysocket/react";
import React, { useEffect, useState } from "react";

type Player = {
  id: string;
  name: string;
  class: string;
  hp: number;
  maxHP: number;
  level?: number;
  alive?: boolean;
};

type GameState = {
  boss?: {
    name: string;
    hp: number;
    maxHP: number;
    level: number;
    special?: boolean;
  };
  players?: Player[];
  started?: boolean;
  [key: string]: unknown;
};

const CLASS_INFO: Record<string, { emoji: string; color: string }> = {
  TANK: { emoji: "🛡️", color: "#4b9cff" },
  WARRIOR: { emoji: "⚔️", color: "#e74c3c" },
  ARCHER: { emoji: "🏹", color: "#2ecc71" },
  MAGE: { emoji: "🔮", color: "#9b59b6" },
  PRIEST: { emoji: "✝️", color: "#f1c40f" },
};

function App() {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [events, setEvents] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);

  const room =
    window.location.pathname.replace(/^\/+/, "") || "arena";

  const socket = usePartySocket({
    party: "chat",
    room,

    onOpen: () => {
      setConnected(true);

      socket.send(
        JSON.stringify({
          type: "initGame",
        }),
      );
    },

    onClose: () => {
      setConnected(false);
    },

    onMessage: (evt) => {
      try {
        const message = JSON.parse(evt.data as string);

        console.log("SERVER:", message);

        if (message.type === "roomState") {
          setGameState(message.gameState ?? message.state ?? null);
        }

        if (message.type === "gameState") {
          setGameState(message.gameState ?? message.state ?? null);
        }

        if (message.type === "gameStateUpdate") {
          setGameState(message.gameState ?? message.state ?? null);
        }

        if (message.type === "playerJoined") {
          addEvent(
            `🎮 ${message.name ?? "Jogador"} entrou como ${
              message.class ?? "?"
            }`,
          );
        }

        if (message.type === "playerLeft") {
          addEvent(`👋 ${message.name ?? "Jogador"} saiu`);
        }

        if (message.type === "attackResult") {
          if (message.damage != null) {
            addEvent(
              `⚔️ ${message.playerName ?? "Jogador"} causou ${message.damage} de dano!`,
            );
          }
        }

        if (message.type === "bossAttackResult") {
          if (message.damage != null) {
            addEvent(
              `👹 Boss causou ${message.damage} de dano!`,
            );
          }
        }

        if (message.type === "skillResult") {
          addEvent(
            `✨ ${message.class ?? "Jogador"} usou uma habilidade especial!`,
          );
        }

        if (message.type === "healResult") {
          addEvent(`💚 Priest curou um aliado!`);
        }

        if (message.type === "gameEvent") {
          if (message.message) {
            addEvent(String(message.message));
          }
        }
      } catch (error) {
        console.error("Erro ao processar mensagem:", error);
      }
    },
  });

  function addEvent(text: string) {
    setEvents((old) => [text, ...old].slice(0, 12));
  }

  function send(type: string) {
    socket.send(JSON.stringify({ type }));
  }

  function attack() {
    send("attack");
  }

  function skill() {
    send("skill");
  }

  function heal() {
    send("heal");
  }

  const players = Array.isArray(gameState?.players)
    ? gameState.players
    : [];

  const boss = gameState?.boss;

  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top, #24133f 0%, #0b0812 55%, #050509 100%)",
        color: "#fff",
        fontFamily:
          "Arial, Helvetica, sans-serif",
        padding: "20px",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          maxWidth: "1100px",
          margin: "0 auto",
        }}
      >
        <header
          style={{
            textAlign: "center",
            marginBottom: "25px",
          }}
        >
          <h1
            style={{
              margin: 0,
              fontSize: "38px",
              textShadow: "0 0 20px #9b59b6",
            }}
          >
            👻 BOOS FIGHT
          </h1>

          <div
            style={{
              marginTop: "8px",
              color: connected ? "#2ecc71" : "#e74c3c",
              fontWeight: "bold",
            }}
          >
            {connected ? "🟢 CONECTADO" : "🔴 DESCONECTADO"}
          </div>

          <div
            style={{
              marginTop: "5px",
              color: "#aaa",
              fontSize: "13px",
            }}
          >
            Twitch: digite <b>!play</b> no chat para entrar
          </div>
        </header>

        {boss && (
          <section
            style={{
              background:
                "linear-gradient(180deg, #35101a, #170b10)",
              border: "2px solid #e74c3c",
              borderRadius: "18px",
              padding: "20px",
              marginBottom: "20px",
              boxShadow: "0 0 30px rgba(231,76,60,.25)",
            }}
          >
            <div
              style={{
                textAlign: "center",
                fontSize: "14px",
                color: "#ff8f8f",
              }}
            >
              BOSS • LEVEL {boss.level ?? 1}
            </div>

            <h2
              style={{
                textAlign: "center",
                margin: "8px 0 15px",
                fontSize: "30px",
              }}
            >
              👹 {boss.name ?? "BOSS"}
            </h2>

            <div
              style={{
                height: "28px",
                background: "#32151a",
                borderRadius: "15px",
                overflow: "hidden",
                border: "1px solid #63242c",
              }}
            >
              <div
                style={{
                  width: `${Math.max(
                    0,
                    Math.min(
                      100,
                      ((boss.hp ?? 0) /
                        Math.max(1, boss.maxHP ?? 1)) *
                        100,
                    ),
                  )}%`,
                  height: "100%",
                  background:
                    "linear-gradient(90deg, #e74c3c, #ff7675)",
                  transition: "width .3s",
                }}
              />
            </div>

            <div
              style={{
                textAlign: "center",
                marginTop: "8px",
                fontWeight: "bold",
              }}
            >
              {boss.hp ?? 0} / {boss.maxHP ?? 0} HP
            </div>
          </section>
        )}

        <section
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fit, minmax(180px, 1fr))",
            gap: "12px",
            marginBottom: "20px",
          }}
        >
          {players.map((player) => {
            const info =
              CLASS_INFO[player.class] ?? {
                emoji: "👤",
                color: "#888",
              };

            const hpPercent =
              ((player.hp ?? 0) /
                Math.max(1, player.maxHP ?? 1)) *
              100;

            return (
              <div
                key={player.id}
                style={{
                  background: "#15121d",
                  border: `2px solid ${info.color}`,
                  borderRadius: "15px",
                  padding: "15px",
                  opacity:
                    player.alive === false ||
                    player.hp <= 0
                      ? 0.45
                      : 1,
                }}
              >
                <div
                  style={{
                    fontSize: "25px",
                    textAlign: "center",
                  }}
                >
                  {info.emoji}
                </div>

                <div
                  style={{
                    textAlign: "center",
                    fontWeight: "bold",
                    marginTop: "5px",
                  }}
                >
                  {player.name}
                </div>

                <div
                  style={{
                    textAlign: "center",
                    color: info.color,
                    fontSize: "12px",
                    marginTop: "3px",
                  }}
                >
                  {player.class}
                  {player.level
                    ? ` • LV ${player.level}`
                    : ""}
                </div>

                <div
                  style={{
                    height: "10px",
                    background: "#292532",
                    borderRadius: "8px",
                    marginTop: "12px",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${Math.max(
                        0,
                        Math.min(100, hpPercent),
                      )}%`,
                      height: "100%",
                      background: info.color,
                    }}
                  />
                </div>

                <div
                  style={{
                    textAlign: "center",
                    fontSize: "12px",
                    marginTop: "5px",
                  }}
                >
                  {player.hp} / {player.maxHP} HP
                </div>
              </div>
            );
          })}
        </section>

        <section
          style={{
            display: "flex",
            justifyContent: "center",
            gap: "10px",
            flexWrap: "wrap",
            marginBottom: "20px",
          }}
        >
          <button
            onClick={attack}
            style={buttonStyle("#e74c3c")}
          >
            ⚔️ ATACAR
          </button>

          <button
            onClick={skill}
            style={buttonStyle("#9b59b6")}
          >
            ✨ ESPECIAL
          </button>

          <button
            onClick={heal}
            style={buttonStyle("#2ecc71")}
          >
            💚 CURAR
          </button>
        </section>

        <section
          style={{
            background: "#0d0b13",
            border: "1px solid #30293b",
            borderRadius: "15px",
            padding: "15px",
          }}
        >
          <h3
            style={{
              marginTop: 0,
              color: "#c9a7ff",
            }}
          >
            📜 Batalha
          </h3>

          {events.length === 0 ? (
            <div
              style={{
                color: "#777",
              }}
            >
              Aguardando eventos...
            </div>
          ) : (
            events.map((event, index) => (
              <div
                key={`${event}-${index}`}
                style={{
                  padding: "7px 0",
                  borderBottom:
                    "1px solid #1d1825",
                  fontSize: "14px",
                }}
              >
                {event}
              </div>
            ))
          )}
        </section>
      </div>
    </div>
  );
}

function buttonStyle(background: string) {
  return {
    border: "none",
    borderRadius: "12px",
    padding: "14px 25px",
    background,
    color: "#fff",
    fontWeight: "bold",
    fontSize: "15px",
    cursor: "pointer",
    boxShadow: `0 5px 20px ${background}55`,
  };
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
