import type { ComponentProps } from 'react';
import type { MaterialCommunityIcons } from '@expo/vector-icons';

/**
 * Ícone do MaterialCommunityIcons a partir do texto do endereço / lugar (autocomplete, favoritos).
 * Ordem: tipos mais específicos antes dos genéricos.
 */
export function inferPlaceIcon(
  description: string,
): ComponentProps<typeof MaterialCommunityIcons>['name'] {
  const d = description.toLowerCase();

  // Ensino superior (antes de “escola” genérico)
  if (
    d.includes('universidade') ||
    d.includes('faculdade') ||
    d.includes('instituto federal') ||
    d.includes('instituto tecnológico') ||
    d.includes('instituto tecnologico') ||
    d.includes('cefet') ||
    d.includes('ceft') ||
    d.includes('pós-graduação') ||
    d.includes('pos-graduacao') ||
    d.includes('mba ') ||
    d.includes(' campus ') ||
    d.endsWith(' campus') ||
    d.includes('universitário') ||
    d.includes('universitario')
  ) {
    return 'library';
  }

  // Escola / ensino básico
  if (
    d.includes('escola') ||
    d.includes('colégio') ||
    d.includes('colegio') ||
    d.includes('ensino fundamental') ||
    d.includes('ensino médio') ||
    d.includes('ensino medio') ||
    d.includes('creche') ||
    d.includes('berçário') ||
    d.includes('bercario') ||
    d.includes('educação infantil') ||
    d.includes('educacao infantil')
  ) {
    return 'school';
  }

  // Biblioteca pública / municipal
  if (d.includes('biblioteca')) {
    return 'library-shelves';
  }

  // Saúde
  if (
    d.includes('hospital') ||
    d.includes('pronto-socorro') ||
    d.includes('pronto socorro') ||
    d.includes('upa ') ||
    d.includes('upa-') ||
    d.includes('clínica') ||
    d.includes('clinica') ||
    d.includes('posto de saúde') ||
    d.includes('posto de saude') ||
    d.includes('psf') ||
    d.includes('maternidade') ||
    d.includes('hemocentro') ||
    d.includes('laboratório') ||
    d.includes('laboratorio')
  ) {
    return 'hospital-box';
  }

  // Compras / varejo
  if (
    d.includes('shop') ||
    d.includes('mall') ||
    d.includes('shopping') ||
    d.includes('centro comercial') ||
    d.includes('lojas') ||
    d.includes('outlet')
  ) {
    return 'shopping-outline';
  }

  if (
    d.includes('supermercado') ||
    d.includes('hipermercado') ||
    d.includes('mercado ') ||
    d.includes('atacadão') ||
    d.includes('atacadao') ||
    d.includes('minimercado')
  ) {
    return 'cart-outline';
  }

  if (d.includes('farmácia') || d.includes('farmacia') || d.includes('drogaria')) {
    return 'pill';
  }

  // Religião
  if (
    d.includes('igreja') ||
    d.includes('templo') ||
    d.includes('paróquia') ||
    d.includes('paroquia') ||
    d.includes('mesquita') ||
    d.includes('sinagoga') ||
    d.includes('catedral') ||
    d.includes('capela')
  ) {
    return 'church-outline';
  }

  // Alimentação
  if (
    d.includes('restaurante') ||
    d.includes('lanchonete') ||
    d.includes('padaria') ||
    d.includes('café') ||
    d.includes('cafe') ||
    d.includes('bar ') ||
    d.includes('pub ') ||
    d.includes('pizzaria') ||
    d.includes('churrascaria') ||
    d.includes('sorveteria') ||
    d.includes('açaiteria') ||
    d.includes('acaiteria')
  ) {
    return 'silverware-fork-knife';
  }

  // Hospedagem
  if (d.includes('hotel') || d.includes('pousada') || d.includes('hostel') || d.includes('resort')) {
    return 'bed-outline';
  }

  // Transporte aéreo
  if (d.includes('aeroporto') || d.includes('airport')) {
    return 'airplane';
  }

  // Financeiro
  if (
    d.includes('banco ') ||
    d.includes('banco,') ||
    d.startsWith('banco ') ||
    d.includes('caixa eletrônico') ||
    d.includes('caixa eletronico') ||
    d.includes('agência banc') ||
    d.includes('agencia banc')
  ) {
    return 'bank-outline';
  }

  // Lazer / ar livre
  if (
    d.includes('parque') ||
    d.includes('park') ||
    d.includes('praça') ||
    d.includes('praca') ||
    d.includes('jardim botânico') ||
    d.includes('jardim botanico') ||
    d.includes('zoológico') ||
    d.includes('zoologico')
  ) {
    return 'pine-tree';
  }

  if (d.includes('cine') || d.includes('cinema') || d.includes('teatro')) {
    return 'filmstrip';
  }

  if (d.includes('estádio') || d.includes('estadio') || d.includes('arena ') || d.includes('ginásio')) {
    return 'stadium';
  }

  if (d.includes('museu')) {
    return 'palette-outline';
  }

  // Transporte terrestre
  if (
    d.includes('metrô') ||
    d.includes('metro') ||
    d.includes('estação de metrô') ||
    d.includes('estacao de metro')
  ) {
    return 'subway-variant';
  }

  if (
    d.includes('rodoviária') ||
    d.includes('rodoviaria') ||
    d.includes('terminal rodovi') ||
    d.includes('estação rodovi') ||
    d.includes('estacao rodovi')
  ) {
    return 'bus';
  }

  if (d.includes('estação ferrovi') || d.includes('estacao ferrovi') || d.includes('trem ')) {
    return 'train';
  }

  // Serviços / utilidades
  if (d.includes('estacionamento') || d.includes('parking') || d.includes(' estapar')) {
    return 'parking';
  }

  if (
    d.includes('posto ') && (d.includes('combust') || d.includes('gasolina') || d.includes('shell') || d.includes('petro'))
  ) {
    return 'gas-station';
  }

  if (d.includes('correios') || d.includes('correio')) {
    return 'email-outline';
  }

  if (d.includes('academia') || d.includes('ginástica') || d.includes('ginastica') || d.includes('crossfit')) {
    return 'dumbbell';
  }

  if (
    d.includes('delegacia') ||
    d.includes('polícia') ||
    d.includes('policia') ||
    d.includes('polícia militar') ||
    d.includes('batalhão')
  ) {
    return 'shield-account';
  }

  if (
    d.includes('prefeitura') ||
    d.includes('câmara municipal') ||
    d.includes('camara municipal') ||
    d.includes('paço municipal') ||
    d.includes('paco municipal')
  ) {
    return 'domain';
  }

  if (d.includes('cartório') || d.includes('cartorio') || d.includes('forum') || d.includes('fórum')) {
    return 'gavel';
  }

  if (d.includes('cemitério') || d.includes('cemitario')) {
    return 'grave-stone';
  }

  return 'map-marker-outline';
}
