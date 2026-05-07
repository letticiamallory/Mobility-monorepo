import { API_URL } from '../constants/api';
import { saveUserInfo } from './token.service';

function formatApiErrorBody(data: Record<string, unknown>, status: number): string {
  const m = data.message;
  if (typeof m === 'string' && m.trim()) return m.trim();
  if (Array.isArray(m)) {
    const parts = m
      .map((item: unknown) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && 'message' in item) {
          return String((item as { message: unknown }).message);
        }
        if (item && typeof item === 'object' && 'constraints' in item) {
          const c = (item as { constraints?: Record<string, string> }).constraints;
          if (c && typeof c === 'object') return Object.values(c).join(' ');
        }
        return '';
      })
      .filter(Boolean);
    if (parts.length) return parts.join(' ');
  }
  return `HTTP ${status}`;
}

export type LoginResponse = {
  access_token: string;
  user_id: number;
  name: string;
  email?: string;
};

export async function login(email: string, password: string) {
  const loginUrl = `${API_URL}/auth/login`;
  const payload = { email: email.trim().toLowerCase(), password };

  let response: Response;
  try {
    response = await fetch(loginUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    const hint =
      err instanceof TypeError
        ? ' Verifique se o celular/emulador acessa o mesmo IP em constants/api.ts e se o backend está ligado.'
        : '';
    throw new Error(`Não foi possível conectar ao servidor (${API_URL}).${hint}`);
  }

  const text = await response.text();

  let data: Record<string, unknown> = {};
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    throw new Error(
      `Resposta inválida do servidor (HTTP ${response.status}). O corpo não é JSON — confira a URL e o backend.`,
    );
  }

  if (!response.ok) {
    const msg = formatApiErrorBody(data, response.status);
    throw new Error(
      msg !== `HTTP ${response.status}`
        ? msg
        : `Login recusado (HTTP ${response.status}). Email ou senha incorretos, ou usuário inexistente.`,
    );
  }

  const token = data.access_token as string | undefined;
  if (!token) {
    throw new Error(
      'O servidor respondeu OK mas sem access_token. Ajuste o backend ou o formato esperado pelo app.',
    );
  }

  const userId = data.user_id as number | undefined;
  const name = (data.name as string | undefined) ?? '';
  const userEmail = (data.email as string | undefined) ?? email;
  if (userId === undefined || userId === null) {
    throw new Error('Resposta do login sem user_id. Verifique o contrato da API.');
  }

  await saveUserInfo(userId, name, userEmail);
  return data as LoginResponse;
}

export async function register(
  name: string,
  email: string,
  password: string,
  disability_type: string,
  accompanied?: string,
  confirmPassword?: string,
  avatarBase64?: string,
  avatarMime?: string,
) {
  const body: Record<string, string> = {
    name,
    email: email.trim().toLowerCase(),
    password,
    confirm_password: confirmPassword ?? password,
    disability_type,
  };
  if (accompanied) body.accompanied = accompanied;
  if (avatarBase64?.trim()) {
    body.avatar_base64 = avatarBase64.trim();
    if (avatarMime?.trim()) body.avatar_mime = avatarMime.trim();
  }

  const url = `${API_URL}/users`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const hint =
      err instanceof TypeError
        ? ' Verifique constants/api.ts e se o backend está acessível deste aparelho/emulador.'
        : '';
    throw new Error(`Não foi possível conectar ao servidor (${API_URL}).${hint}`);
  }

  const text = await response.text();

  let data: Record<string, unknown> = {};
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    if (!response.ok) {
      throw new Error(
        `Cadastro recusado (HTTP ${response.status}). A resposta não é JSON — veja os logs do servidor.`,
      );
    }
  }

  if (!response.ok) {
    const detail = formatApiErrorBody(data, response.status);
    throw new Error(
      detail !== `HTTP ${response.status}`
        ? `Cadastro: ${detail}`
        : `Cadastro recusado (HTTP ${response.status}). Email já em uso ou dados inválidos.`,
    );
  }

  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function forgotPassword(email: string) {
  const url = `${API_URL}/auth/forgot-password`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
  } catch (err) {
    const hint =
      err instanceof TypeError
        ? ' Verifique constants/api.ts e se o backend está acessível deste aparelho/emulador.'
        : '';
    throw new Error(`Não foi possível conectar ao servidor (${API_URL}).${hint}`);
  }

  const text = await response.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    data = {};
  }
  if (!response.ok) {
    const detail = formatApiErrorBody(data, response.status);
    throw new Error(
      detail !== `HTTP ${response.status}`
        ? detail
        : `Falha ao solicitar código (HTTP ${response.status}).`,
    );
  }
  return data;
}

export async function verifyResetCode(email: string, code: string) {
  const url = `${API_URL}/auth/verify-reset-code`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim().toLowerCase(), code: code.trim() }),
  });
  const text = await response.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    data = {};
  }
  if (!response.ok) {
    const detail = formatApiErrorBody(data, response.status);
    throw new Error(detail !== `HTTP ${response.status}` ? detail : 'Código inválido ou expirado.');
  }
  return data as { reset_token: string; expires_in_seconds: number };
}

export async function resetPassword(
  email: string,
  resetToken: string,
  newPassword: string,
  confirmPassword: string,
) {
  const url = `${API_URL}/auth/reset-password`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: email.trim().toLowerCase(),
      reset_token: resetToken,
      new_password: newPassword,
      confirm_password: confirmPassword,
    }),
  });
  const text = await response.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    data = {};
  }
  if (!response.ok) {
    const detail = formatApiErrorBody(data, response.status);
    throw new Error(detail !== `HTTP ${response.status}` ? detail : 'Não foi possível redefinir a senha.');
  }
  return data as { message: string };
}