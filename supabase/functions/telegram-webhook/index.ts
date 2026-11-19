import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  computeDaySummaryMetrics,
  formatBRL,
  formatDateWithWeekdayBR,
  getSaoPauloTodayStr,
  parseDailyLogMessage,
  parseTelegramCommand,
  type BikeSettingsRow,
  type MaintenanceItemRow,
} from './parser.ts';

interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  username?: string;
}

interface TelegramChat {
  id: number;
  type: string;
}

interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

interface TelegramLinkRow {
  user_id: string;
  telegram_user_id: number;
  telegram_chat_id: number;
  telegram_username: string | null;
  telegram_first_name: string | null;
}

const DEFAULT_BIKE_SETTINGS: BikeSettingsRow = {
  fuel_consumption_km_l: 30,
  fuel_price_per_liter: 5.89,
};

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  const maxLen = Math.max(aBytes.length, bBytes.length);
  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < maxLen; i += 1) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatKmNumber(value: number): string {
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 1,
    maximumFractionDigits: 2,
  });
}

async function sendTelegramMessage(
  botToken: string,
  chatId: number,
  htmlText: string
): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: htmlText,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw new Error(`Telegram sendMessage falhou (HTTP ${res.status}): ${bodyText}`);
  }
}

function buildHelpMessage(): string {
  return [
    '<b>MotoLucro no Telegram</b> 🏍️',
    '',
    'Envie seus lançamentos direto por aqui no formato:',
    '<code>KM_INICIAL KM_FINAL VALOR</code>',
    '',
    '<b>Exemplos práticos:</b>',
    '• <code>10490 10620 250</code>',
    '• <code>10490 10620 250,50</code>',
    '• <code>10490 10620 =120+85,50</code> (soma estilo Excel)',
    '• <code>ontem 10490 10620 250</code>',
    '• <code>18/11 10490 10620 250 09:40 18:20</code>',
    '• <code>km inicial: 10490, km final: 10620, valor: 250</code>',
    '',
    '<b>Comandos disponíveis:</b>',
    '/ultimo — Mostra o último dia registrado',
    '/resumo — Resumo do mês atual',
    '/ajuda — Ver estes exemplos',
    '/desvincular — Desconectar sua conta',
  ].join('\n');
}

function buildPairingInstructionsMessage(): string {
  return [
    'Sua conta MotoLucro ainda não está vinculada a este Telegram.',
    '',
    'Para conectar:',
    '1. Abra o <b>MotoLucro</b> e vá em <b>Minha Conta</b>.',
    '2. No card <b>Bot no Telegram</b>, clique em <b>Gerar Código de Vínculo</b>.',
    '3. Envie aqui: <code>/vincular SEUCODIGO</code>',
  ].join('\n');
}

async function fetchUserCostContext(
  supabase: ReturnType<typeof createClient>,
  userId: string
): Promise<{
  settings: BikeSettingsRow;
  hasSavedSettings: boolean;
  bikeName: string;
  maintenanceItems: MaintenanceItemRow[];
}> {
  const [settingsRes, maintRes] = await Promise.all([
    supabase
      .from('bike_settings')
      .select('bike_name, fuel_consumption_km_l, fuel_price_per_liter')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('maintenance_items')
      .select('cost, duration_km')
      .eq('user_id', userId),
  ]);

  if (settingsRes.error) throw settingsRes.error;
  if (maintRes.error) throw maintRes.error;

  const hasSavedSettings = Boolean(settingsRes.data);
  const settings: BikeSettingsRow = settingsRes.data
    ? {
        fuel_consumption_km_l: Number(settingsRes.data.fuel_consumption_km_l),
        fuel_price_per_liter: Number(settingsRes.data.fuel_price_per_liter),
      }
    : DEFAULT_BIKE_SETTINGS;

  const bikeName =
    typeof settingsRes.data?.bike_name === 'string' && settingsRes.data.bike_name.trim()
      ? settingsRes.data.bike_name.trim()
      : 'Minha Moto';

  const maintenanceItems: MaintenanceItemRow[] = (maintRes.data ?? []).map(
    (m: Record<string, unknown>) => ({
      cost: Number(m.cost),
      duration_km: Number(m.duration_km),
    })
  );

  return { settings, hasSavedSettings, bikeName, maintenanceItems };
}

async function fetchUnexpectedSumForDate(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  logDate: string
): Promise<number> {
  const { data, error } = await supabase
    .from('unexpected_expenses')
    .select('amount')
    .eq('user_id', userId)
    .eq('expense_date', logDate);

  if (error) throw error;
  return (data ?? []).reduce(
    (sum: number, row: Record<string, unknown>) => sum + (Number(row.amount) || 0),
    0
  );
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const webhookSecret = Deno.env.get('TELEGRAM_WEBHOOK_SECRET') ?? '';
  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  if (!webhookSecret || !botToken || !supabaseUrl || !serviceRoleKey) {
    console.error('Missing required environment variables in telegram-webhook');
    return jsonResponse({ error: 'Server misconfigured' }, 500);
  }

  const receivedSecret = req.headers.get('x-telegram-bot-api-secret-token') ?? '';
  if (!receivedSecret || !timingSafeEqual(receivedSecret, webhookSecret)) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  let update: TelegramUpdate;
  try {
    update = (await req.json()) as TelegramUpdate;
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  if (typeof update?.update_id !== 'number') {
    return jsonResponse({ ok: true, ignored: true });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Deduplicação idempotente de retries do Telegram
  const { error: dedupErr } = await supabase
    .from('telegram_processed_updates')
    .insert({ update_id: update.update_id });

  if (dedupErr) {
    if (dedupErr.code === '23505') {
      return jsonResponse({ ok: true, deduplicated: true });
    }
    console.error('Failed to record processed update_id:', dedupErr.message);
    return jsonResponse({ error: 'Database error' }, 500);
  }

  try {
    const message = update.message;
    if (!message || !message.chat) {
      return jsonResponse({ ok: true, ignored: 'no_message' });
    }

    if (message.chat.type !== 'private') {
      return jsonResponse({ ok: true, ignored: 'non_private_chat' });
    }

    const chatId = message.chat.id;
    const telegramUserId = message.from?.id;
    if (typeof telegramUserId !== 'number') {
      return jsonResponse({ ok: true, ignored: 'no_sender' });
    }

    const rawText = typeof message.text === 'string' ? message.text.trim() : '';
    if (!rawText) {
      await sendTelegramMessage(
        botToken,
        chatId,
        'Envie uma mensagem de texto com <code>KM_INICIAL KM_FINAL VALOR</code> (ex.: <code>10490 10620 250</code>) ou /ajuda.'
      );
      return jsonResponse({ ok: true });
    }

    const telegramUsername = message.from?.username ?? null;
    const telegramFirstName = message.from?.first_name ?? null;

    const { data: existingLinkData, error: linkFetchErr } = await supabase
      .from('telegram_links')
      .select('user_id, telegram_user_id, telegram_chat_id, telegram_username, telegram_first_name')
      .eq('telegram_user_id', telegramUserId)
      .maybeSingle();

    if (linkFetchErr) throw linkFetchErr;
    const existingLink = existingLinkData as TelegramLinkRow | null;

    const command = parseTelegramCommand(rawText);

    if (command?.type === 'ajuda') {
      await sendTelegramMessage(botToken, chatId, buildHelpMessage());
      return jsonResponse({ ok: true });
    }

    if (command?.type === 'start' && !command.code) {
      if (existingLink) {
        const greeting = telegramFirstName
          ? `Olá, <b>${escapeHtml(telegramFirstName)}</b>!`
          : 'Olá!';
        await sendTelegramMessage(
          botToken,
          chatId,
          `${greeting} Sua conta MotoLucro já está conectada.\n\n${buildHelpMessage()}`
        );
      } else {
        await sendTelegramMessage(
          botToken,
          chatId,
          `Bem-vindo ao <b>MotoLucro</b>! 🏍️\n\n${buildPairingInstructionsMessage()}`
        );
      }
      return jsonResponse({ ok: true });
    }

    if (
      (command?.type === 'start' && command.code) ||
      command?.type === 'vincular'
    ) {
      const code = command.code?.trim().toUpperCase() ?? '';
      if (!/^[A-Z0-9]{6,16}$/.test(code)) {
        await sendTelegramMessage(
          botToken,
          chatId,
          'Informe o código de 8 caracteres gerado na aba <b>Minha Conta</b> do MotoLucro.\nExemplo: <code>/vincular AB12CD34</code>'
        );
        return jsonResponse({ ok: true });
      }

      const nowIso = new Date().toISOString();
      const { data: codeRow, error: codeErr } = await supabase
        .from('telegram_link_codes')
        .select('id, user_id, expires_at, used_at')
        .eq('code', code)
        .is('used_at', null)
        .gt('expires_at', nowIso)
        .maybeSingle();

      if (codeErr) throw codeErr;
      if (!codeRow) {
        await sendTelegramMessage(
          botToken,
          chatId,
          'Código inválido ou expirado. Gere um novo código no MotoLucro em <b>Minha Conta → Bot no Telegram</b>.'
        );
        return jsonResponse({ ok: true });
      }

      const { data: claimedCode, error: claimErr } = await supabase
        .from('telegram_link_codes')
        .update({ used_at: nowIso })
        .eq('id', codeRow.id)
        .is('used_at', null)
        .select('id, user_id')
        .maybeSingle();

      if (claimErr) throw claimErr;
      if (!claimedCode) {
        await sendTelegramMessage(
          botToken,
          chatId,
          'Este código já foi utilizado. Gere um novo código no MotoLucro se precisar vincular novamente.'
        );
        return jsonResponse({ ok: true });
      }

      // Garante vínculo 1:1 limpo removendo associações anteriores desse usuário ou chat
      const { error: cleanupErr } = await supabase
        .from('telegram_links')
        .delete()
        .or(
          `user_id.eq.${claimedCode.user_id},telegram_user_id.eq.${telegramUserId},telegram_chat_id.eq.${chatId}`
        );
      if (cleanupErr) throw cleanupErr;

      const { error: insertLinkErr } = await supabase.from('telegram_links').insert({
        user_id: claimedCode.user_id,
        telegram_user_id: telegramUserId,
        telegram_chat_id: chatId,
        telegram_username: telegramUsername,
        telegram_first_name: telegramFirstName,
        linked_at: nowIso,
      });
      if (insertLinkErr) throw insertLinkErr;

      await sendTelegramMessage(
        botToken,
        chatId,
        [
          '✅ <b>Conta MotoLucro vinculada com sucesso!</b>',
          '',
          'Agora basta mandar uma mensagem aqui no formato:',
          '<code>10490 10620 250</code>',
          '',
          'Ou com soma estilo Excel:',
          '<code>10490 10620 =120+85,50</code>',
          '',
          'Use /ajuda a qualquer momento para ver todos os formatos.',
        ].join('\n')
      );
      return jsonResponse({ ok: true });
    }

    // A partir daqui, exige conta vinculada
    if (!existingLink) {
      await sendTelegramMessage(botToken, chatId, buildPairingInstructionsMessage());
      return jsonResponse({ ok: true });
    }

    const userId = existingLink.user_id;

    if (command?.type === 'desvincular') {
      const { error: delErr } = await supabase
        .from('telegram_links')
        .delete()
        .eq('telegram_user_id', telegramUserId);
      if (delErr) throw delErr;

      await sendTelegramMessage(
        botToken,
        chatId,
        '🔌 Sua conta foi desvinculada deste Telegram. Quando quiser reconectar, gere um novo código em <b>Minha Conta</b> no MotoLucro.'
      );
      return jsonResponse({ ok: true });
    }

    if (command?.type === 'ultimo') {
      const { data: lastLog, error: lastErr } = await supabase
        .from('daily_logs')
        .select('id, log_date, earnings, km_start, km_end, km_total, start_time, end_time')
        .eq('user_id', userId)
        .order('log_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lastErr) throw lastErr;

      if (!lastLog) {
        await sendTelegramMessage(
          botToken,
          chatId,
          'Você ainda não tem lançamentos salvos na nuvem. Envie seu primeiro dia assim: <code>10490 10620 250</code>'
        );
        return jsonResponse({ ok: true });
      }

      const logDate = String(lastLog.log_date);
      const kmStart = Number(lastLog.km_start);
      const kmEnd = Number(lastLog.km_end);
      const kmTotal = Number(lastLog.km_total) || Math.max(0, kmEnd - kmStart);
      const earnings = Number(lastLog.earnings);

      const [{ settings, maintenanceItems }, unexpectedCost] = await Promise.all([
        fetchUserCostContext(supabase, userId),
        fetchUnexpectedSumForDate(supabase, userId, logDate),
      ]);

      const metrics = computeDaySummaryMetrics(
        kmTotal,
        earnings,
        settings,
        maintenanceItems,
        unexpectedCost
      );

      const timeLine =
        lastLog.start_time && lastLog.end_time
          ? `🕒 Horário: ${escapeHtml(String(lastLog.start_time))} → ${escapeHtml(String(lastLog.end_time))}\n`
          : '';

      await sendTelegramMessage(
        botToken,
        chatId,
        [
          `📋 <b>Último lançamento — ${escapeHtml(formatDateWithWeekdayBR(logDate))}</b>`,
          `🛣️ KM: ${formatKmNumber(kmStart)} → ${formatKmNumber(kmEnd)} (<b>${formatKmNumber(kmTotal)} km</b>)`,
          timeLine ? timeLine.trimEnd() : null,
          `💵 Valor bruto: <b>${escapeHtml(formatBRL(metrics.grossEarnings))}</b> (${escapeHtml(formatBRL(metrics.grossPerKm))}/km)`,
          `⛽ Custos est.: ${escapeHtml(formatBRL(metrics.totalCost))} (comb. ${escapeHtml(formatBRL(metrics.fuelCost))} + desg. ${escapeHtml(formatBRL(metrics.maintenanceCost))}${metrics.unexpectedCost > 0 ? ` + imprev. ${escapeHtml(formatBRL(metrics.unexpectedCost))}` : ''})`,
          `💰 Lucro líquido est.: <b>${escapeHtml(formatBRL(metrics.netProfit))}</b> (${escapeHtml(formatBRL(metrics.netPerKm))}/km)`,
        ]
          .filter(Boolean)
          .join('\n')
      );
      return jsonResponse({ ok: true });
    }

    if (command?.type === 'resumo') {
      const todayStr = getSaoPauloTodayStr();
      const monthPrefix = todayStr.slice(0, 7);
      const monthStart = `${monthPrefix}-01`;
      const [yearStr, monthStr] = monthPrefix.split('-');
      const lastDay = new Date(Date.UTC(Number(yearStr), Number(monthStr), 0)).getUTCDate();
      const monthEnd = `${monthPrefix}-${String(lastDay).padStart(2, '0')}`;

      const [logsRes, costCtx, unexpRes] = await Promise.all([
        supabase
          .from('daily_logs')
          .select('log_date, earnings, km_start, km_end, km_total')
          .eq('user_id', userId)
          .gte('log_date', monthStart)
          .lte('log_date', monthEnd),
        fetchUserCostContext(supabase, userId),
        supabase
          .from('unexpected_expenses')
          .select('amount')
          .eq('user_id', userId)
          .gte('expense_date', monthStart)
          .lte('expense_date', monthEnd),
      ]);

      if (logsRes.error) throw logsRes.error;
      if (unexpRes.error) throw unexpRes.error;

      const logs = logsRes.data ?? [];
      if (logs.length === 0) {
        await sendTelegramMessage(
          botToken,
          chatId,
          `📊 Nenhum lançamento encontrado em <b>${monthStr}/${yearStr}</b> ainda.`
        );
        return jsonResponse({ ok: true });
      }

      let totalGross = 0;
      let totalKm = 0;
      for (const row of logs) {
        const kmStart = Number(row.km_start) || 0;
        const kmEnd = Number(row.km_end) || 0;
        const km = Number(row.km_total) || Math.max(0, kmEnd - kmStart);
        totalKm += km;
        totalGross += Number(row.earnings) || 0;
      }

      const totalUnexpected = (unexpRes.data ?? []).reduce(
        (acc: number, row: Record<string, unknown>) => acc + (Number(row.amount) || 0),
        0
      );

      const metrics = computeDaySummaryMetrics(
        totalKm,
        totalGross,
        costCtx.settings,
        costCtx.maintenanceItems,
        totalUnexpected
      );

      await sendTelegramMessage(
        botToken,
        chatId,
        [
          `📊 <b>Resumo de ${monthStr}/${yearStr}</b> (${logs.length} ${logs.length === 1 ? 'dia' : 'dias'})`,
          `🛣️ Rodagem total: <b>${formatKmNumber(totalKm)} km</b>`,
          `💵 Faturamento bruto: <b>${escapeHtml(formatBRL(metrics.grossEarnings))}</b> (${escapeHtml(formatBRL(metrics.grossPerKm))}/km)`,
          `⛽ Custos estimados: ${escapeHtml(formatBRL(metrics.totalCost))}`,
          `💰 Lucro líquido est.: <b>${escapeHtml(formatBRL(metrics.netProfit))}</b> (${escapeHtml(formatBRL(metrics.netPerKm))}/km)`,
        ].join('\n')
      );
      return jsonResponse({ ok: true });
    }

    // Caso padrão: interpretar mensagem como lançamento diário
    const parsed = parseDailyLogMessage(rawText);
    if (!parsed.ok) {
      await sendTelegramMessage(botToken, chatId, `⚠️ ${escapeHtml(parsed.error)}`);
      return jsonResponse({ ok: true });
    }

    const entry = parsed.data;

    // Verifica se já existe lançamento para essa data (mantendo consistência 1 registro/dia do app)
    const { data: existingDay, error: dayErr } = await supabase
      .from('daily_logs')
      .select('id, start_time, end_time, notes')
      .eq('user_id', userId)
      .eq('log_date', entry.logDate)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (dayErr) throw dayErr;

    let wasUpdated = false;
    if (existingDay) {
      wasUpdated = true;
      const { error: updateErr } = await supabase
        .from('daily_logs')
        .update({
          earnings: entry.earnings,
          km_start: entry.kmStart,
          km_end: entry.kmEnd,
          km_total: entry.kmTotal,
          start_time: entry.startTime ?? existingDay.start_time ?? null,
          end_time: entry.endTime ?? existingDay.end_time ?? null,
        })
        .eq('id', existingDay.id)
        .eq('user_id', userId);
      if (updateErr) throw updateErr;
    } else {
      const { error: insertErr } = await supabase.from('daily_logs').insert({
        id: crypto.randomUUID(),
        user_id: userId,
        log_date: entry.logDate,
        earnings: entry.earnings,
        km_start: entry.kmStart,
        km_end: entry.kmEnd,
        km_total: entry.kmTotal,
        start_time: entry.startTime,
        end_time: entry.endTime,
        notes: null,
      });
      if (insertErr) throw insertErr;
    }

    const [costCtx, unexpectedCost] = await Promise.all([
      fetchUserCostContext(supabase, userId),
      fetchUnexpectedSumForDate(supabase, userId, entry.logDate),
    ]);

    const metrics = computeDaySummaryMetrics(
      entry.kmTotal,
      entry.earnings,
      costCtx.settings,
      costCtx.maintenanceItems,
      unexpectedCost
    );

    const header = wasUpdated
      ? `✏️ <b>Lançamento atualizado — ${escapeHtml(formatDateWithWeekdayBR(entry.logDate))}</b>`
      : `✅ <b>Lançamento registrado — ${escapeHtml(formatDateWithWeekdayBR(entry.logDate))}</b>`;

    const formulaDetail =
      entry.isFormula && entry.normalizedFormula
        ? ` (<code>${escapeHtml(entry.normalizedFormula)}</code>)`
        : '';

    const timeDetail =
      entry.startTime && entry.endTime
        ? `🕒 Horário: ${escapeHtml(entry.startTime)} → ${escapeHtml(entry.endTime)}`
        : null;

    const settingsHint = !costCtx.hasSavedSettings
      ? '\n<i>Dica: clique em "Sincronizar Dados com a Nuvem" no app para usar o consumo e peças exatos da sua moto.</i>'
      : '';

    await sendTelegramMessage(
      botToken,
      chatId,
      [
        header,
        `🛣️ KM: ${formatKmNumber(entry.kmStart)} → ${formatKmNumber(entry.kmEnd)} (<b>${formatKmNumber(entry.kmTotal)} km</b>)`,
        timeDetail,
        `💵 Valor bruto: <b>${escapeHtml(formatBRL(metrics.grossEarnings))}</b>${formulaDetail} • ${escapeHtml(formatBRL(metrics.grossPerKm))}/km`,
        `⛽ Custos est.: ${escapeHtml(formatBRL(metrics.totalCost))} (comb. ${escapeHtml(formatBRL(metrics.fuelCost))} + desg. ${escapeHtml(formatBRL(metrics.maintenanceCost))}${metrics.unexpectedCost > 0 ? ` + imprev. ${escapeHtml(formatBRL(metrics.unexpectedCost))}` : ''})`,
        `💰 Lucro líquido est.: <b>${escapeHtml(formatBRL(metrics.netProfit))}</b> (${escapeHtml(formatBRL(metrics.netPerKm))}/km)${settingsHint}`,
      ]
        .filter(Boolean)
        .join('\n')
    );

    return jsonResponse({ ok: true });
  } catch (err) {
    console.error('Error processing telegram-webhook update:', err instanceof Error ? err.message : String(err));
    // Libera update_id para permitir retry legítimo do Telegram em caso de erro transitório
    await supabase
      .from('telegram_processed_updates')
      .delete()
      .eq('update_id', update.update_id);

    return jsonResponse({ error: 'Internal error' }, 500);
  }
});
