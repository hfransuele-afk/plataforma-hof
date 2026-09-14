/**
 * Ficha de Anamnese Clínica & Estética Oficial
 * Dra. Fransuele Hanel • Biomedicina Estética Avançada & Integrativa • CRBM-5: 015427
 */

const formSections = [
  {
    id: 'dados-pessoais',
    title: '1. Dados Pessoais e Experiência do Paciente',
    fields: [
      { name: 'nomeCompleto', label: 'Nome Completo', type: 'text', required: true },
      { name: 'dataNascimento', label: 'Data de Nascimento', type: 'date' },
      { name: 'idade', label: 'Idade (anos)', type: 'number', min: 0, max: 120 },
      {
        name: 'genero',
        label: 'Gênero',
        type: 'radio',
        options: ['Feminino', 'Masculino', 'Outro']
      },
      { name: 'cpf', label: 'CPF', type: 'text', placeholder: '000.000.000-00' },
      { name: 'profissao', label: 'Profissão', type: 'text' },
      { name: 'whatsapp', label: 'WhatsApp / Telefone Celular', type: 'tel', required: true, placeholder: '(00) 00000-0000' },
      { name: 'email', label: 'E-mail', type: 'email', required: true, placeholder: 'seuemail@exemplo.com' },
      { name: 'instagram', label: 'Instagram', type: 'text', placeholder: '@seu.usuario' },
      { name: 'endereco', label: 'Endereço Residencial', type: 'text' },
      { name: 'cidadeUf', label: 'Cidade / UF', type: 'text', placeholder: 'Ex: Curitiba / PR' },
      { name: 'contatoEmergencia', label: 'Contato de Emergência (Nome e Parentesco)', type: 'text' },
      { name: 'telEmergencia', label: 'Telefone do Contato de Emergência', type: 'tel', placeholder: '(00) 00000-0000' },
      { name: 'indicacao', label: 'Como nos conheceu? (Indicação / Rede Social)', type: 'text' },
      {
        name: 'experienciaVip',
        label: 'Experiência VIP: Qual música ou estilo prefere ouvir durante o seu procedimento?',
        type: 'text',
        placeholder: 'Ex.: MPB, Jazz, Pop acústico, Clássica, Louvor, etc.'
      }
    ]
  },
  {
    id: 'queixa-expectativas',
    title: '2. Queixa Principal, Expectativas e Histórico Estético',
    fields: [
      {
        name: 'queixaPrincipal',
        label: 'Qual é a sua principal queixa ou incômodo hoje?',
        type: 'textarea',
        required: true,
        placeholder: 'Descreva detalhadamente o que mais incomoda na face ou no corpo...'
      },
      {
        name: 'queixasAssociadas',
        label: 'Queixas associadas (selecione todas que se aplicam)',
        type: 'checkbox-group',
        options: [
          'Envelhecimento precoce',
          'Linhas / Rugas dinâmicas',
          'Flacidez cutânea',
          'Olheiras / Cansaço',
          'Manchas / Melasma',
          'Lábios desidratados/finos'
        ]
      },
      {
        name: 'tempoIncomodo',
        label: 'Há quanto tempo esse incômodo persiste?',
        type: 'text',
        placeholder: 'Ex: 6 meses, 2 anos...'
      },
      {
        name: 'grauSatisfacao',
        label: 'Grau de satisfação facial atual (de 0 a 5)',
        type: 'radio',
        options: ['0 - Muito insatisfeita(o)', '1', '2', '3', '4', '5 - Muito satisfeita(o)']
      },
      {
        name: 'buscaResultado',
        label: 'O que você mais busca no resultado?',
        type: 'checkbox-group',
        options: [
          'Naturalidade absoluta',
          'Elevação da autoestima',
          'Rejuvenescimento sutil',
          'Autoridade visual',
          'Harmonização marcante'
        ]
      },
      {
        name: 'eventoSocialProximo',
        label: 'Possui algum evento social ou profissional importante nos próximos 20 dias?',
        type: 'radio',
        options: ['Não', 'Sim']
      },
      {
        name: 'eventoSocialDetalhes',
        label: 'Se marcou "Sim", quando e qual evento?',
        type: 'text',
        placeholder: 'Ex: Casamento no próximo fim de semana, gravação, formatura...'
      },
      {
        name: 'procedimentosAnteriores',
        label: 'Procedimentos estéticos anteriores já realizados',
        type: 'checkbox-group',
        options: [
          'Toxina Botulínica (Botox)',
          'Preenchimento com Ácido Hialurônico',
          'Bioestimuladores de Colágeno',
          'Fios de PDO',
          'PMMA definitivo',
          'Cirurgia Facial (Rinoplastia / Lifting)',
          'Nenhum procedimento anterior'
        ]
      },
      {
        name: 'dataUltimoProcedimentoReacoes',
        label: 'Data do último procedimento e reações / intercorrências anteriores (se houver)',
        type: 'textarea',
        placeholder: 'Ex: Fiz botox há 6 meses sem intercorrências; fiz preenchimento labial há 1 ano...'
      }
    ]
  },
  {
    id: 'historico-clinico',
    title: '3. Histórico Clínico & Segurança Biológica',
    fields: [
      {
        name: 'condicoesSaude',
        label: 'Condições de saúde e antecedentes clínicos (selecione todas que possui)',
        type: 'checkbox-group',
        options: [
          'Doenças Autoimunes (Lúpus, Hashimoto, Psoríase, etc.)',
          'Diabetes Mellitus (Tipo 1 / Tipo 2 / Controlada?)',
          'Distúrbios de Coagulação / Trombose / Embolia',
          'Tendência a Queloides ou Cicatriz Hipertrófica',
          'Histórico Oncológico / Neoplasias (Câncer prévio/atual)',
          'Doenças Renais, Hepáticas ou Respiratórias (Asma)',
          'Próteses ou Placas Metálicas na Face/Corpo',
          'Doenças de Pele Ativas (Dermatite, Rosácea, Acne severa)',
          'Hipertensão Arterial (Pressão alta / baixa)',
          'Cardiopatias / Uso de Marcapasso',
          'Tendência a Hematomas Frequentes / Cicatrização Lenta',
          'Histórico de Herpes (Labial / Facial)',
          'Epilepsia / Histórico de Convulsões ou Desmaios',
          'Doenças Infectocontagiosas (Hepatites, HIV, etc.)',
          'Fratura, trauma facial ou cirurgia plástica prévia',
          'Alterações da Tireoide (Hipotireoidismo / Hipertireoidismo)',
          'Nenhuma das condições acima'
        ]
      },
      {
        name: 'detalhesCondicoes',
        label: 'Descreva detalhes das condições marcadas acima (se aplicável)',
        type: 'textarea',
        placeholder: 'Informe detalhes, tipo de controle ou medicamentos específicos...'
      },
      {
        name: 'protesesPlacasOnde',
        label: 'Se possui próteses ou placas metálicas, informe onde:',
        type: 'text',
        placeholder: 'Ex: Prótese dentária com pino de titânio na maxila, prótese mamária...'
      },
      {
        name: 'ultimoEpisodioHerpes',
        label: 'Se tem histórico de herpes, quando ocorreu o último episódio?',
        type: 'text',
        placeholder: 'Ex: Há mais de 1 ano; nunca tive na face...'
      }
    ]
  },
  {
    id: 'alergias-habitos',
    title: '4. Alergias, Medicações Recentes & Hábitos de Vida',
    fields: [
      {
        name: 'alergiasConhecidas',
        label: 'Alergias conhecidas',
        type: 'checkbox-group',
        options: [
          'Anestésicos (Lidocaína)',
          'Látex',
          'Frutos do mar / Iodo',
          'Dipirona / AAS / Anti-inflamatórios',
          'Antibióticos',
          'Cosméticos / Ácidos',
          'Nenhuma alergia conhecida'
        ]
      },
      {
        name: 'outrasAlergias',
        label: 'Outras alergias ou intolerâncias:',
        type: 'text',
        placeholder: 'Ex: Alergia a esparadrapo, picada de inseto...'
      },
      {
        name: 'medicamentosContinuos',
        label: 'Medicamentos de uso contínuo ou controlados:',
        type: 'textarea',
        placeholder: 'Nome dos medicamentos, dosagens e horário de uso...'
      },
      {
        name: 'usoRecente15Dias',
        label: 'Medicamentos utilizados nos últimos 15 dias:',
        type: 'checkbox-group',
        options: [
          'Anti-inflamatórios (AINEs)',
          'AAS / Anticoagulantes',
          'Antibióticos / Corticoides',
          'Fitoterápicos / Ginkgo Biloba / Ômega 3',
          'Nenhum medicamento recente'
        ]
      },
      {
        name: 'roacutanUltimos12Meses',
        label: 'Fez uso de Roacutan (Isotretinoína) nos últimos 12 meses?',
        type: 'radio',
        options: ['Não', 'Sim']
      },
      {
        name: 'reposicaoHormonalAnticoncepcional',
        label: 'Reposição hormonal / Anticoncepcional em uso:',
        type: 'text',
        placeholder: 'Ex: DIU Mirena, pílula contínua, reposição bioidêntica, não uso...'
      },
      {
        name: 'febreInfeccaoRecente',
        label: 'Teve febre, resfriado ou infecção nos últimos 15 dias?',
        type: 'radio',
        options: ['Não', 'Sim']
      },
      {
        name: 'vacinaUltimos30Dias',
        label: 'Tomou vacina nos últimos 30 dias?',
        type: 'radio',
        options: ['Não', 'Sim']
      },
      {
        name: 'procedimentoOdonto',
        label: 'Realizou procedimento odontológico recente ou tem previsto nos próximos 30 dias?',
        type: 'radio',
        options: ['Não', 'Sim']
      },
      {
        name: 'gestanteLactante',
        label: 'Situação gestacional / lactação:',
        type: 'radio',
        options: ['Não se aplica', 'Gestante', 'Lactante']
      },
      {
        name: 'exposicaoSolar',
        label: 'Exposição solar habitual:',
        type: 'radio',
        options: ['Baixa', 'Média', 'Alta']
      },
      {
        name: 'protetorSolarDiario',
        label: 'Usa protetor solar diariamente?',
        type: 'radio',
        options: ['Sim', 'Não']
      },
      {
        name: 'fpsProtetor',
        label: 'Se usa protetor solar, qual o FPS e frequência de reaplicação?',
        type: 'text',
        placeholder: 'Ex: FPS 50 com cor, reaplico 1x ao dia...'
      },
      {
        name: 'tabagismo',
        label: 'Tabagismo:',
        type: 'radio',
        options: ['Não fumante', 'Fumante']
      },
      {
        name: 'consumoAgua',
        label: 'Consumo diário de água:',
        type: 'radio',
        options: ['Menos de 1 Litro', '1 a 2 Litros', 'Mais de 2 Litros']
      }
    ]
  },
  {
    id: 'termo-responsabilidade',
    title: '5. Termo de Responsabilidade & Declaração de Veracidade',
    fields: [
      {
        name: 'termoResponsabilidadeAceito',
        label: 'Declaro que todas as informações prestadas nesta ficha de anamnese clínica são verdadeiras, exatas e completas, não tendo omitido nenhum fato relevante sobre meu histórico de saúde, medicamentos ou tratamentos anteriores. Estou ciente de que a segurança e o resultado dos procedimentos estéticos dependem diretamente da veracidade destes dados (LGPD - Lei nº 13.709/18).',
        type: 'checkbox-single',
        required: true
      },
      {
        name: 'assinatura',
        label: 'Nome completo legível da paciente (confirmação da assinatura)',
        type: 'text',
        required: true,
        placeholder: 'Digite seu nome completo'
      },
      {
        name: 'dataAssinatura',
        label: 'Data da assinatura',
        type: 'date',
        required: true
      }
    ]
  }
];

function buildFieldLabelMap() {
  const map = {};
  for (const section of formSections) {
    for (const field of section.fields) {
      map[field.name] = field.label;
    }
  }

  // Compatibilidade com campos legados de fotos
  map.facePhotos = 'Fotos do rosto';
  map.productPhotos = 'Fotos dos produtos da rotina';
  map.examFiles = 'Exames anexados';

  return map;
}

module.exports = {
  formSections,
  fieldLabels: buildFieldLabelMap()
};
