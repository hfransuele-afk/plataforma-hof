/**
 * Modelos de Termos de Consentimento Livre e Esclarecido (TCLE)
 * para procedimentos clínicos e estéticos da Plataforma Fran.
 */

const consentTemplates = [
  {
    slug: 'toxina-botulinica',
    title: 'Termo de Consentimento — Toxina Botulínica',
    procedure_name: 'Aplicação de Toxina Botulínica (Botox)',
    content: `TERMO DE CONSENTIMENTO LIVRE E ESCLARECIDO (TCLE)
APLICAÇÃO DE TOXINA BOTULÍNICA

Eu, {{NOME_PACIENTE}}, declaro que fui devidamente informada(o) pela profissional Fran sobre o procedimento de aplicação de Toxina Botulínica.

1. FINALIDADE DO PROCEDIMENTO:
A aplicação visa o relaxamento temporário dos músculos faciais responsáveis pelas rugas de expressão (linhas dinâmicas), suavizando marcas em regiões como fronte (testa), glabela (entre as sobrancelhas), perioculares ("pés de galinha") e outras áreas previamente avaliadas.

2. DURAÇÃO E RESULTADOS:
Compreendo que os resultados começam a ser visíveis entre 48 horas e 15 dias após a aplicação, com duração média estimada de 3 a 5 meses, variando conforme o metabolismo individual, prática intensa de atividades físicas e resposta biológica de cada organismo.

3. POSSÍVEIS EFEITOS E REAÇÕES:
Fui orientada(o) de que podem ocorrer pequenos edemas (inchaço), eritema (vermelhidão), pequenos hematomas nos locais das picadas, leve dor de cabeça transitória ou assimetrias temporárias que poderão ser corrigidas na consulta de retorno (geralmente entre 15 e 21 dias).

4. CUIDADOS PÓS-PROCEDIMENTO:
Comprometo-me a seguir todas as orientações pós-aplicação: não deitar ou abaixar a cabeça nas primeiras 4 horas, não massagear ou pressionar as áreas tratadas, não praticar atividades físicas intensas nas primeiras 24 horas e não se expor ao calor intenso (sauna/sol) nos primeiros dias.

5. DECLARAÇÃO E CONSENTIMENTO:
Declaro que informei com veracidade todo o meu histórico de saúde, uso de medicamentos, alergias e eventual estado de gravidez ou amamentação. Tive a oportunidade de esclarecer todas as dúvidas e concordo voluntariamente com a realização do procedimento.`
  },
  {
    slug: 'acido-hialuronico',
    title: 'Termo de Consentimento — Preenchimento com Ácido Hialurônico',
    procedure_name: 'Preenchimento Dérmico com Ácido Hialurônico',
    content: `TERMO DE CONSENTIMENTO LIVRE E ESCLARECIDO (TCLE)
PREENCHIMENTO COM ÁCIDO HIALURÔNICO

Eu, {{NOME_PACIENTE}}, declaro que fui devidamente informada(o) sobre o procedimento de preenchimento facial/labial com Ácido Hialurônico.

1. NATUREZA DO PRODUTO E FINALIDADE:
O ácido hialurônico é um biomaterial estéril e biocompatível, utilizado para volumização, harmonização, estruturação facial, sustentação e hidratação profunda de áreas como lábios, sulcos, malar, mandíbula, queixo ou olheiras.

2. DURAÇÃO DOS EFEITOS:
O produto é reabsorvível pelo organismo, com durabilidade média variável de 9 a 18 meses dependendo da região tratada, densidade do produto e características individuais.

3. POSSÍVEIS EFEITOS ADVERSOS:
É comum o surgimento de inchaço, sensibilidade, assimetria temporária decorrente do edema e hematomas nos primeiros 3 a 7 dias. Fui informada(o) sobre os sinais de alerta vascular e a importância de contato imediato caso note dor desproporcional ou alteração de coloração da pele.

4. CUIDADOS PÓS-PROCEDIMENTO:
Não massagear vigorosamente a região, evitar exposição solar enquanto houver hematomas, não praticar exercícios físicos nas primeiras 24-48 horas e aplicar compressas frias conforme recomendado.

5. DECLARAÇÃO:
Confirmo ter respondido com verdade todas as perguntas sobre meu estado de saúde e autorizo a realização do procedimento.`
  },
  {
    slug: 'bioestimulador-colageno',
    title: 'Termo de Consentimento — Bioestimulador de Colágeno',
    procedure_name: 'Aplicação de Bioestimulador de Colágeno',
    content: `TERMO DE CONSENTIMENTO LIVRE E ESCLARECIDO (TCLE)
BIOESTIMULADOR DE COLÁGENO (Ácido Poli-L-Láctico / Hidroxiapatita de Cálcio)

Eu, {{NOME_PACIENTE}}, declaro ter sido plenamente informada(o) sobre o tratamento com Bioestimuladores de Colágeno.

1. OBJETIVO DO TRATAMENTO:
Estimular a produção gradual e natural de novas fibras de colágeno pelo próprio organismo, melhorando a espessura dérmica, firmeza, textura e reduzindo a flacidez tecidual facial ou corporal.

2. EXPECTATIVA DE RESULTADOS:
Compreendo que a melhora é progressiva, iniciando-se a partir da 4ª semana com pico de resultados entre o 3º e 6º mês. Podem ser necessárias de 1 a 3 sessões para o alcance do objetivo terapêutico desejado.

3. CUIDADOS E MASSAGEM OBRIGATÓRIA:
Fui orientada(o) sobre a indispensável realização de massagens na área tratada (regra 5x5x5 ou protocolo especificado pela profissional) para evitar a formação de pequenos nódulos ou grumos de produto.

4. REAÇÕES ESPERADAS:
Edema transitório, discreto desconforto à palpação e eventuais equimoses/hematomas nos locais de entrada das cânulas ou agulhas.

5. CONSENTIMENTO:
Esclareci todas as minhas dúvidas e autorizo o início do protocolo de bioestímulo de colágeno.`
  },
  {
    slug: 'peeling-quimico',
    title: 'Termo de Consentimento — Peeling Químico',
    procedure_name: 'Peeling Químico Facial',
    content: `TERMO DE CONSENTIMENTO LIVRE E ESCLARECIDO (TCLE)
PEELING QUÍMICO

Eu, {{NOME_PACIENTE}}, confirmo que recebi todas as orientações sobre a realização do Peeling Químico.

1. OBJETIVO:
Promover renovação celular programada através da aplicação tópica de ácidos específicos, atuando no tratamento de manchas, melasma, oleosidade, acne ativa, poros dilatados e textura cutânea.

2. REAÇÕES ESPERADAS DURANTE E APÓS A SESSÃO:
Pode ocorrer sensação de ardência, calor ou pinicação durante a aplicação. Nos dias seguintes (geralmente entre o 2º e o 7º dia), poderá haver descamação, ressecamento, sensação de repuxamento e leve eritema.

3. CUIDADOS OBRIGATÓRIOS:
- JAMAIS puxar, esfoliar ou arrancar as pelinhas que estiverem descamando.
- Utilizar protetor solar com FPS alto com reaplicação regular a cada 2 a 3 horas.
- Não se expor diretamente ao sol, praia, piscina ou saunas durante o período de recuperação.
- Utilizar apenas os produtos calmantes e regeneradores prescritos pela profissional.

4. AUTORIZAÇÃO:
Concordo com o plano de aplicação e comprometo-me a seguir estritamente os cuidados de home care indicados.`
  },
  {
    slug: 'microagulhamento',
    title: 'Termo de Consentimento — Microagulhamento / Drug Delivery',
    procedure_name: 'Microagulhamento com Drug Delivery',
    content: `TERMO DE CONSENTIMENTO LIVRE E ESCLARECIDO (TCLE)
MICROAGULHAMENTO FACIAL COM DRUG DELIVERY

Eu, {{NOME_PACIENTE}}, declaro ter sido esclarecida(o) sobre o microagulhamento com sistema de agulhas estéreis e descartáveis.

1. MECANISMO E OBJETIVO:
Criação de microlesões controladas na epiderme e derme para estimular a cascata inflamatória positiva de reparação tecidual e colágeno, associado à permeação otimizada de ativos estéreis (fatores de crescimento, clareadores e peptídeos).

2. FASE PÓS-PROCEDIMENTO:
A pele apresentará vermelhidão intensa e calor nas primeiras 24 a 48 horas, semelhante a uma queimadura solar leve, seguida por leve descamação e sensibilidade temporária.

3. RESTRIÇÕES IMPORTANTES:
Não aplicar maquiagem nas primeiras 24 horas; não se expor ao sol; não utilizar ácidos até a completa recuperação da barreira cutânea; usar somente produtos hipoalergênicos e regeneradores recomendados.

4. ACEITE:
Confirmo a inexistência de infecções cutâneas ativas (como herpes labial ativa) e autorizo o procedimento.`
  },
  {
    slug: 'limpeza-de-pele',
    title: 'Termo de Consentimento — Limpeza de Pele Profunda',
    procedure_name: 'Limpeza de Pele Profunda com Extração',
    content: `TERMO DE CONSENTIMENTO LIVRE E ESCLARECIDO (TCLE)
LIMPEZA DE PELE PROFUNDA E HIGIENIZAÇÃO CUTÂNEA

Eu, {{NOME_PACIENTE}}, autorizo a realização do procedimento de Limpeza de Pele Profunda.

1. OBJETIVO:
Higienização, emoliência, desobstrução de poros, extração criteriosa de comedões (cravos) e miliums, controle da oleosidade e hidratação profunda.

2. REAÇÕES NATURAIS:
A extração manual e mecânica pode ocasionar vermelhidão temporária, sensibilidade ou pequenas marquinhas passageiras nas regiões de maior acúmulo de impurezas, que regridem em até 24 a 48 horas.

3. RECOMENDAÇÕES PÓS-EXTRAÇÃO:
Evitar o uso de maquiagens pesadas nas primeiras 12 horas, manter a higienização suave, não espremer eventuais lesões residuais e aplicar protetor solar diariamente.

4. ACEITE:
Concordo e autorizo o atendimento.`
  },
  {
    slug: 'fios-de-pdo',
    title: 'Termo de Consentimento — Fios de Sustentação / PDO',
    procedure_name: 'Aplicação de Fios de PDO (Polidioxanona)',
    content: `TERMO DE CONSENTIMENTO LIVRE E ESCLARECIDO (TCLE)
FIOS DE POLIDIOXANONA (PDO)

Eu, {{NOME_PACIENTE}}, declaro ter sido esclarecida(o) sobre o tratamento com Fios de PDO (lisos, espiculados ou de tração).

1. OBJETIVO DO TRATAMENTO:
Os fios de PDO são biocompatíveis e absorvíveis pelo corpo. Atuam promovendo estímulo intensivo de colágeno ao longo do seu trajeto ou realizando tração/sustentação mecânica de tecidos ptosados (caídos).

2. EXPECTATIVAS E SENSAÇÕES PÓS-PROCEDIMENTO:
É esperado leve desconforto à mastigação ou mímica facial nos primeiros dias, edema localizado, sensação de repuxamento e eventuais pequenos hematomas. O processo de absorção ocorre entre 6 a 8 meses, enquanto o colágeno gerado permanece por tempo superior.

3. CUIDADOS ESPECÍFICOS:
Evitar movimentos mastigatórios bruscos ou excessivamente amplos nos primeiros 7 dias; dormir preferencialmente de barriga para cima; evitar massagens faciais ou manipulação da área tratada por 30 dias.

4. AUTORIZAÇÃO:
Concordo plenamente e autorizo a execução do procedimento.`
  },
  {
    slug: 'geral-estetica',
    title: 'Termo Geral de Consentimento — Procedimentos Estéticos',
    procedure_name: 'Procedimento Estético / Terapêutico Geral',
    content: `TERMO GERAL DE CONSENTIMENTO LIVRE E ESCLARECIDO (TCLE)
PROCEDIMENTOS ESTÉTICOS E DERMOCOSMÉTICOS

Eu, {{NOME_PACIENTE}}, declaro que busquei livremente os serviços profissionais da Fran e autorizo a realização do protocolo acordado em consulta prévia.

1. INFORMAÇÕES GERAIS:
Fui informada(o) com clareza a respeito da natureza do procedimento, seus benefícios esperados, limitações terapêuticas, alternativas disponíveis e cuidados necessários antes e depois da sessão.

2. INDIVIDUALIDADE BIOLÓGICA:
Reconheço que a estética depende diretamente da resposta biológica individual de cada organismo, hábitos de vida, exposição solar, alimentação e cumprimento das orientações de cuidados diários (home care), não sendo possível garantir resultados idênticos aos de outros pacientes.

3. VERACIDADE DAS INFORMAÇÕES:
Garanto que declarei todas as condições de saúde, alergias, medicações em uso e alterações recentes do meu estado físico no questionário de anamnese.

4. CONSENTIMENTO VOLUNTÁRIO:
Tive todas as minhas dúvidas sanadas e concedo minha livre autorização para a realização do tratamento.`
  }
];

module.exports = {
  consentTemplates
};
