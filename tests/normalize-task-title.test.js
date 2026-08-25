'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeTaskTitle } = require('../migration/normalize-task-title');

const validCases = [
  ['AUT | Infraestrutura | Passagem de cabos', 'AUT', 'Infraestrutura', 'Passagem de cabos'],
  ['AAV | Configuração Final | Configuração de Home Cinema', 'AAV', 'Configuração Final', 'Configuração de Home Cinema'],
  ['RED | Instalação | Configuração de rede', 'RED', 'Instalação', 'Configuração de rede'],
  ['SEG | Treinamento | Treinamento do cliente', 'SEG', 'Treinamento', 'Treinamento do cliente'],
  ['FIN | 1º Pagamento | Recebimento', 'FIN', '1º Pagamento', 'Recebimento'],
  ['ONB | Pré-Configuração | Preparação do projeto', 'ONB', 'Pré-Configuração', 'Preparação do projeto'],
  ['VTE | Infraestrutura | Visita técnica', 'VTE', 'Infraestrutura', 'Visita técnica']
];

for (const [title, typeCode, stage, name] of validCases) {
  test(`normaliza: ${title}`, () => {
    assert.deepEqual(normalizeTaskTitle(title), {
      typeCode, stage, name, originalName: title, issue: null
    });
  });
}

test('aceita espaços extras e diferenças de caixa', () => {
  assert.deepEqual(normalizeTaskTitle('  aut  |  instalação |  Sensor  '), {
    typeCode: 'AUT', stage: 'Instalação', name: 'Sensor',
    originalName: '  aut  |  instalação |  Sensor  ', issue: null
  });
});

test('preserva todos os segmentos do nome após a etapa', () => {
  assert.equal(
    normalizeTaskTitle('AUT | Instalação | Instalação | Rack principal').name,
    'Instalação | Rack principal'
  );
});

for (const code of ['AUTO', 'REDES', 'AAT', 'AAC']) {
  test(`rejeita alias/código ${code}`, () => {
    const title = `${code} | Infraestrutura | Exemplo`;
    assert.deepEqual(normalizeTaskTitle(title), {
      typeCode: null, stage: null, name: title, originalName: title,
      issue: 'UNKNOWN_TYPE_CODE'
    });
  });
}

test('anula toda a classificação quando a etapa é desconhecida', () => {
  const title = 'AUT | PROJETO | Entrega de projeto';
  assert.deepEqual(normalizeTaskTitle(title), {
    typeCode: null, stage: null, name: title, originalName: title,
    issue: 'UNKNOWN_STAGE'
  });
});

for (const title of ['Configuração Wifeed', 'Instalação da Infraestrutura', 'AUT | INSTALAÇÃO', '', null, undefined]) {
  test(`rejeita título sem estrutura: ${String(title)}`, () => {
    assert.equal(normalizeTaskTitle(title).issue, 'INVALID_TITLE_FORMAT');
    assert.equal(normalizeTaskTitle(title).typeCode, null);
    assert.equal(normalizeTaskTitle(title).stage, null);
  });
}
