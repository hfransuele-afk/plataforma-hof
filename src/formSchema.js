const formSections = [
  {
    id: 'dados-pessoais',
    title: '1) Dados Pessoais',
    fields: [
      { name: 'nomeCompleto', label: 'Nome completo', type: 'text', required: true },
      { name: 'nomeSocial', label: 'Nome social (se diferente)', type: 'text' },
      { name: 'idade', label: 'Idade', type: 'number', min: 0 },
      { name: 'dataNascimento', label: 'Data de nascimento', type: 'date' },
      { name: 'cidadeEstado', label: 'Cidade / Estado', type: 'text' },
      { name: 'profissao', label: 'Profissão', type: 'text' },
      { name: 'telefone', label: 'Telefone', type: 'tel' },
      { name: 'instagram', label: 'Instagram', type: 'text' },
      { name: 'email', label: 'E-mail', type: 'email', required: true }
    ]
  },
  {
    id: 'saude-geral',
    title: '2) Informações Gerais de Saúde',
    fields: [
      {
        name: 'gravidaOuAmamentando',
        label: 'Está grávida ou amamentando?',
        type: 'radio',
        options: ['Sim', 'Não'],
        required: true
      },
      { name: 'anticoncepcional', label: 'Usa anticoncepcional? Qual?', type: 'text' },
      {
        name: 'doencasDiagnosticadas',
        label: 'Possui alguma doença diagnosticada? (SOP, hipotireoidismo, diabetes, dermatite, rosácea, outras)',
        type: 'textarea'
      },
      {
        name: 'acompanhamentoDermatologista',
        label: 'Faz acompanhamento com dermatologista?',
        type: 'radio',
        options: ['Sim', 'Não']
      },
      { name: 'medicamentoContinuo', label: 'Usa medicamento contínuo? Qual?', type: 'text' },
      { name: 'reacaoAlergicaCosmeticos', label: 'Já teve reação alérgica a cosméticos? Qual?', type: 'text' },
      { name: 'historicoAlergias', label: 'Histórico de alergias (respiratórias ou cutâneas)', type: 'textarea' }
    ]
  },
  {
    id: 'exames',
    title: '3) Exames Recentes (Opcional)',
    fields: [
      {
        name: 'possuiExamesHormonais',
        label: 'Possui exames hormonais recentes?',
        type: 'radio',
        options: ['Sim', 'Não']
      },
      {
        name: 'alteracoesExames',
        label: 'Já apresentou alterações em',
        type: 'checkbox-group',
        options: ['Ferro', 'Vitamina D', 'B12', 'Tireoide', 'Insulina', 'Testosterona']
      },
      { name: 'desejaCompartilharExame', label: 'Observações sobre os exames', type: 'textarea' },
      { name: 'examFiles', label: 'Enviar arquivos de exames (imagem ou PDF)', type: 'file', accept: 'image/*,application/pdf', multiple: true }
    ]
  },
  {
    id: 'saude-hormonal',
    title: '4) Saúde Hormonal e Ciclo Menstrual',
    fields: [
      {
        name: 'alteracaoPelePeriodo',
        label: 'Você percebe alteração da pele no período menstrual? (pode marcar mais de uma)',
        type: 'checkbox-group',
        options: ['Sim, piora antes', 'Sim, piora durante', 'Não percebo alteração', 'Não se aplica']
      },
      {
        name: 'tipoCiclo',
        label: 'Seu ciclo é',
        type: 'radio',
        options: ['Regular', 'Irregular', 'Uso anticoncepcional', 'DIU hormonal', 'DIU de cobre', 'Não menstruo']
      },
      {
        name: 'diagnosticoHormonal',
        label: 'Diagnóstico de',
        type: 'checkbox-group',
        options: ['SOP', 'Endometriose', 'Alteração hormonal', 'Nenhum']
      },
      {
        name: 'acneMandibula',
        label: 'Apresenta acne na região de queixo/mandíbula?',
        type: 'radio',
        options: ['Sim', 'Não']
      }
    ]
  },
  {
    id: 'fase-vida',
    title: '5) Fase da Vida',
    fields: [
      {
        name: 'faseVida',
        label: 'Você se encontra em (pode marcar mais de uma)',
        type: 'checkbox-group',
        options: ['Adolescência', 'Vida adulta jovem', 'Perimenopausa', 'Menopausa', 'Pós-menopausa']
      },
      {
        name: 'mudancasRecentesVida',
        label: 'Mudanças recentes percebidas',
        type: 'checkbox-group',
        options: ['Ressecamento acentuado', 'Perda de firmeza', 'Afinamento da pele', 'Ondas de calor', 'Alteração de humor']
      }
    ]
  },
  {
    id: 'mudancas-hormonais',
    title: '6) Mudanças Hormonais Recentes',
    fields: [
      {
        name: 'mudancasUltimos12Meses',
        label: 'Nos últimos 12 meses',
        type: 'checkbox-group',
        options: ['Iniciou ou suspendeu anticoncepcional', 'Gravidez / pós-parto', 'Aborto', 'Ganho/perda significativa de peso', 'Tratamento hormonal', 'Nenhuma mudança']
      },
      { name: 'mudancaPeleApos', label: 'Percebeu mudança na pele após isso? Descreva', type: 'textarea' }
    ]
  },
  {
    id: 'impacto-emocional',
    title: '7) Impacto Emocional',
    fields: [
      {
        name: 'situacoesEmocionais',
        label: 'Nos últimos 6 meses você passou por',
        type: 'checkbox-group',
        options: ['Estresse intenso', 'Ansiedade', 'Luto', 'Mudança profissional', 'Problemas familiares', 'Nenhuma situação relevante']
      },
      { name: 'nivelEstresse', label: 'Nível atual de estresse (0 a 10)', type: 'number', min: 0, max: 10 },
      { name: 'impactoNaPele', label: 'Acredita que isso impactou sua pele? Como?', type: 'textarea' }
    ]
  },
  {
    id: 'funcionamento-intestinal',
    title: '8) Funcionamento Intestinal',
    fields: [
      {
        name: 'funcionamentoIntestino',
        label: 'Seu intestino funciona',
        type: 'radio',
        options: ['Todos os dias', 'Dia sim, dia não', '2-3x por semana', 'Constipação frequente']
      },
      {
        name: 'sintomasIntestinais',
        label: 'Apresenta',
        type: 'checkbox-group',
        options: ['Inchaço abdominal', 'Gases excessivos', 'Intolerância alimentar', 'Síndrome do intestino irritável', 'Nenhum sintoma']
      }
    ]
  },
  {
    id: 'autopercepcao-pele',
    title: '9) Autopercepção da Pele',
    fields: [
      {
        name: 'tipoPele',
        label: 'Você considera sua pele',
        type: 'checkbox-group',
        options: ['Seca', 'Oleosa', 'Mista', 'Normal', 'Sensível', 'Acneica', 'Madura', 'Não sei definir']
      },
      {
        name: 'comportamentoPele',
        label: 'Sua pele costuma',
        type: 'checkbox-group',
        options: ['Brilhar excessivamente', 'Ficar repuxando', 'Arder com facilidade', 'Descamar', 'Apresentar vermelhidão']
      }
    ]
  },
  {
    id: 'queixa-principal',
    title: '10) Queixa Principal',
    fields: [
      {
        name: 'queixaPrincipal',
        label: 'Qual sua maior queixa hoje?',
        type: 'checkbox-group',
        options: ['Manchas', 'Acne', 'Oleosidade', 'Poros dilatados', 'Linhas finas', 'Flacidez', 'Sensibilidade', 'Olheiras', 'Textura irregular', 'Outro']
      },
      { name: 'tempoIncomodo', label: 'Há quanto tempo te incomoda?', type: 'text' },
      { name: 'tentativasTratamento', label: 'Já tentou tratar? Como?', type: 'textarea' }
    ]
  },
  {
    id: 'exposicao-solar',
    title: '11) Exposição Solar',
    fields: [
      { name: 'trabalhaNoSol', label: 'Trabalha exposta ao sol?', type: 'text' },
      { name: 'usaProtetorDiariamente', label: 'Usa protetor solar diariamente?', type: 'radio', options: ['Sim', 'Não'] },
      { name: 'reaplicaProtetor', label: 'Reaplica durante o dia?', type: 'radio', options: ['Sim', 'Não'] },
      { name: 'melasmaDiagnosticado', label: 'Já teve melasma diagnosticado?', type: 'radio', options: ['Sim', 'Não'] }
    ]
  },
  {
    id: 'rotina-skincare',
    title: '12) Rotina Atual de Skincare',
    fields: [
      { name: 'manhaSabonete', label: 'Manhã - Sabonete', type: 'text' },
      { name: 'manhaSerum', label: 'Manhã - Sérum', type: 'text' },
      { name: 'manhaHidratante', label: 'Manhã - Hidratante', type: 'text' },
      { name: 'manhaProtetor', label: 'Manhã - Protetor solar', type: 'text' },
      { name: 'maquiagemDiaria', label: 'Usa maquiagem diária?', type: 'radio', options: ['Sim', 'Não'] },
      { name: 'removeMaquiagemNoite', label: 'Noite - Remove maquiagem?', type: 'radio', options: ['Sim', 'Não'] },
      { name: 'noiteSabonete', label: 'Noite - Sabonete', type: 'text' },
      { name: 'usaAcidos', label: 'Usa ácidos?', type: 'radio', options: ['Sim', 'Não'] },
      { name: 'usaRetinol', label: 'Usa retinol?', type: 'radio', options: ['Sim', 'Não'] },
      { name: 'noiteHidratante', label: 'Noite - Hidratante', type: 'text' },
      { name: 'frequenciaAcidosRetinol', label: 'Frequência de uso de ácidos/retinol', type: 'text' }
    ]
  },
  {
    id: 'historico-estetico',
    title: '13) Histórico de Tratamentos Estéticos',
    fields: [
      {
        name: 'procedimentosRealizados',
        label: 'Já realizou',
        type: 'checkbox-group',
        options: ['Peeling químico', 'Microagulhamento', 'Laser', 'Limpeza de pele', 'Toxina botulínica', 'Preenchimento', 'Outro']
      },
      { name: 'ultimoProcedimento', label: 'Último procedimento', type: 'text' },
      { name: 'reacaoProcedimento', label: 'Teve reação?', type: 'text' }
    ]
  },
  {
    id: 'estilo-vida',
    title: '14) Estilo de Vida',
    fields: [
      {
        name: 'alimentacao',
        label: 'Alimentação',
        type: 'checkbox-group',
        options: ['Rica em açúcar', 'Rica em industrializados', 'Equilibrada', 'Restritiva']
      },
      { name: 'ingestaoAgua', label: 'Ingestão diária de água', type: 'text' },
      { name: 'atividadeFisica', label: 'Atividade física', type: 'text' },
      { name: 'frequenciaAtividadeFisica', label: 'Frequência de atividade física', type: 'text' },
      {
        name: 'qualidadeSono',
        label: 'Qualidade do sono (pode marcar mais de uma)',
        type: 'checkbox-group',
        options: ['Boa', 'Irregular', 'Insônia']
      }
    ]
  },
  {
    id: 'suplementacao',
    title: '15) Suplementação',
    fields: [
      {
        name: 'suplementos',
        label: 'Suplementação atual',
        type: 'checkbox-group',
        options: ['Colágeno', 'Vitamina D', 'Zinco', 'Ômega 3', 'Creatina', 'Outro']
      }
    ]
  },
  {
    id: 'fototipo',
    title: '16) Fototipo (Fitzpatrick)',
    fields: [
      {
        name: 'fototipo',
        label: 'Selecione seu fototipo',
        type: 'radio',
        options: [
          'Muito clara - sempre queima',
          'Clara - queima fácil',
          'Morena clara - às vezes queima',
          'Morena - raramente queima',
          'Negra clara',
          'Negra escura'
        ]
      }
    ]
  },
  {
    id: 'orcamento',
    title: '17) Orçamento',
    fields: [
      {
        name: 'investimentoPretendido',
        label: 'Pretende investir',
        type: 'radio',
        options: ['Até R$200', 'R$200-400', 'R$400-800', 'Sem limite']
      },
      {
        name: 'preferenciaProdutos',
        label: 'Prefere',
        type: 'checkbox-group',
        options: ['Farmácia', 'Dermocosmético premium', 'Manipulado', 'Melhor custo-benefício']
      }
    ]
  },
  {
    id: 'expectativa',
    title: '18) Expectativa',
    fields: [
      { name: 'expectativaConsultoria', label: 'O que você espera da consultoria?', type: 'textarea' },
      { name: 'prazoResultados', label: 'Em quanto tempo deseja resultados?', type: 'text' },
      {
        name: 'dispostaRotinaConsistente',
        label: 'Está disposta a seguir rotina consistente?',
        type: 'radio',
        options: ['Sim', 'Não']
      }
    ]
  },
  {
    id: 'termo',
    title: '20) Termo de Responsabilidade',
    fields: [
      {
        name: 'termoResponsabilidadeAceito',
        label: 'Declaro que as informações são verdadeiras e estou ciente de que a consultoria não substitui avaliação médica dermatológica.',
        type: 'checkbox-single',
        required: true
      },
      { name: 'assinatura', label: 'Assinatura', type: 'text', required: true },
      { name: 'dataAssinatura', label: 'Data', type: 'date', required: true }
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

  map.facePhotos = 'Fotos do rosto';
  map.productPhotos = 'Fotos de produtos usados';

  return map;
}

module.exports = {
  formSections,
  fieldLabels: buildFieldLabelMap()
};
