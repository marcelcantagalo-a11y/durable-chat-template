// CORREÇÃO DO TWITCH !PLAY
//
// Substitua APENAS os métodos/trechos Twitch equivalentes no seu index.ts
// pelo bloco abaixo. O restante do arquivo permanece exatamente como está.
//
// Principais correções:
// 1. Usa App Access Token para criar EventSub webhook.
// 2. Remove inscrições antigas do mesmo canal/bot antes de criar uma nova.
// 3. Registra claramente status/erro da assinatura.
// 4. Mantém broadcaster_user_id E user_id.
// 5. O webhook registra recebimento antes de processar !play.
// 6. O login continua exigindo a conta bossfightlivearena.

async twitchOAuthCallback(code: string, redirectUri: string) {
  const clientId = this.env.TWITCH_CLIENT_ID;
  const clientSecret = this.env.TWITCH_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
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
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri
      })
    }
  );

  const tokenData: any = await tokenResponse.json();

  if (!tokenResponse.ok || !tokenData.access_token) {
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

  if (!userResponse.ok || !twitchUser) {
    console.error("❌ TWITCH USER ERROR:", userData);
    return {
      ok: false,
      error: "Não foi possível identificar a conta da Twitch."
    };
  }

  if (
    String(twitchUser.login || "").toLowerCase() !==
    Chat.TWITCH_CHANNEL
  ) {
    return {
      ok: false,
      error: `Autorize usando a conta ${Chat.TWITCH_CHANNEL}.`
    };
  }

  await this.ctx.storage.put("twitch:access_token", tokenData.access_token);
  await this.ctx.storage.put("twitch:refresh_token", tokenData.refresh_token || "");
  await this.ctx.storage.put("twitch:user_id", twitchUser.id);
  await this.ctx.storage.put("twitch:user_login", twitchUser.login);

  // EventSub WEBHOOK exige APP ACCESS TOKEN.
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

  if (!appTokenResponse.ok || !appTokenData.access_token) {
    console.error("❌ TWITCH APP TOKEN ERROR:", appTokenData);
    return {
      ok: false,
      error: "Não foi possível criar o token da aplicação Twitch.",
      details: appTokenData
    };
  }

  const appHeaders = {
    "Authorization": `Bearer ${appTokenData.access_token}`,
    "Client-Id": clientId
  };

  const callbackUrl =
    new URL(Chat.TWITCH_EVENTSUB_PATH, redirectUri).toString();

  // Remove assinaturas antigas deste mesmo broadcaster/bot.
  // Isso evita ficar preso a uma assinatura antiga/pending/duplicada.
  try {
    const existingResponse = await fetch(
      "https://api.twitch.tv/helix/eventsub/subscriptions",
      {
        method: "GET",
        headers: appHeaders
      }
    );

    const existingData: any = await existingResponse.json();

    if (existingResponse.ok) {
      const subscriptions = existingData?.data || [];

      for (const sub of subscriptions) {
        if (
          sub.type === "channel.chat.message" &&
          String(sub.condition?.broadcaster_user_id) === String(twitchUser.id) &&
          String(sub.condition?.user_id) === String(twitchUser.id) &&
          sub.transport?.method === "webhook"
        ) {
          console.log(
            "🟡 TWITCH EVENTSUB EXISTENTE:",
            sub.id,
            sub.status
          );

          const deleteResponse = await fetch(
            `https://api.twitch.tv/helix/eventsub/subscriptions?id=${encodeURIComponent(sub.id)}`,
            {
              method: "DELETE",
              headers: appHeaders
            }
          );

          console.log(
            "🗑️ TWITCH EVENTSUB DELETE:",
            sub.id,
            deleteResponse.status
          );
        }
      }
    } else {
      console.error(
        "❌ TWITCH EVENTSUB LIST ERROR:",
        existingResponse.status,
        existingData
      );
    }
  } catch (error) {
    console.error("❌ TWITCH EVENTSUB LIST EXCEPTION:", error);
  }

  const subscriptionResponse = await fetch(
    "https://api.twitch.tv/helix/eventsub/subscriptions",
    {
      method: "POST",
      headers: {
        ...appHeaders,
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

  console.log(
    "🟣 TWITCH EVENTSUB CREATE:",
    subscriptionResponse.status,
    subscriptionData
  );

  if (!subscriptionResponse.ok) {
    console.error(
      "❌ TWITCH EVENTSUB ERROR:",
      subscriptionResponse.status,
      subscriptionData
    );

    return {
      ok: false,
      error: "A Twitch recusou a assinatura do chat.",
      details: subscriptionData
    };
  }

  const createdSubscription =
    subscriptionData?.data?.[0];

  await this.ctx.storage.put(
    "twitch:connected",
    true
  );

  await this.ctx.storage.put(
    "twitch:eventsub_id",
    createdSubscription?.id || ""
  );

  console.log(
    "🟣 TWITCH CONNECTED:",
    twitchUser.login,
    "EVENTSUB STATUS:",
    createdSubscription?.status,
    "ID:",
    createdSubscription?.id
  );

  return {
    ok: true,
    user: twitchUser,
    subscription: subscriptionData
  };
}


// No webhook, substitua o bloco notification por este:
if (messageType === "notification") {
  console.log(
    "🟣 TWITCH EVENTSUB NOTIFICATION:",
    payload.subscription?.type,
    payload.event?.message?.text,
    payload.event?.chatter_user_name
  );

  if (
    payload.subscription?.type ===
    "channel.chat.message"
  ) {
    const result =
      await stub.handleTwitchChatMessage(
        payload.event,
        messageId
      );

    console.log(
      "🟣 TWITCH !PLAY RESULT:",
      result
    );
  }

  return new Response(
    "OK",
    { status: 200 }
  );
}
