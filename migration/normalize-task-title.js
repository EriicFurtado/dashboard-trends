'use strict';

const SERVICE_TYPES = Object.freeze({
  AUT: 'Automação',
  RED: 'Redes',
  SEG: 'Segurança Eletrônica',
  AAV: 'Áudio e Vídeo',
  FIN: 'Financeiro',
  ONB: 'Onboarding',
  VTE: 'Visita Técnica'
});

const STAGES = Object.freeze([
  '1º Pagamento',
  'Compras de materiais',
  'Infraestrutura',
  'Pré-Configuração',
  'Instalação',
  'Configuração Final',
  'Treinamento'
]);

const stageByKey = new Map(STAGES.map((stage) => [stage.toLocaleLowerCase('pt-BR'), stage]));

function invalid(originalName, issue) {return { typeCode: null, stage: null, name: originalName, originalName, issue }}

function normalizeTaskTitle(title) {
  const originalName = title == null ? '' : String(title);
  const parts = originalName.split('|').map((part) => part.trim());
  if(parts.length < 3 || parts[0] === '' || parts[1] === '' || parts.slice(2).every((part) => part === ''))
    return invalid(originalName, 'INVALID_TITLE_FORMAT');
  

  const typeCode = parts[0].toLocaleUpperCase('pt-BR');
  if(!Object.hasOwn(SERVICE_TYPES, typeCode)) return invalid(originalName, 'UNKNOWN_TYPE_CODE');
  

  const stage = stageByKey.get(parts[1].toLocaleLowerCase('pt-BR'));
  if(!stage) return invalid(originalName, 'UNKNOWN_STAGE');
  

  const name = parts.slice(2).join(' | ');
  if(!name.trim()) return invalid(originalName, 'INVALID_TITLE_FORMAT');
  

  return {typeCode, stage, name, originalName, issue: null};
}

module.exports = { normalizeTaskTitle, SERVICE_TYPES, STAGES };
