/**
 * O texto-padrão da Proposta Técnica e Comercial.
 *
 * É o `MBT_STD` do protótipo, tal e qual: a identificação da empresa, a síntese,
 * os critérios do traçado, a execução dos trabalhos, a qualidade/segurança/
 * ambiente, as exclusões, as condições comerciais, a receção, a validade e os
 * contactos. Vem daqui o que não é calculado a partir do orçamento.
 *
 * Fica **gravável** em `CompanySetting` na chave `proposal.standard` (a tabela é
 * chave/valor, não precisa de migração): o que estiver lá ganha a isto, campo a
 * campo. Assim a empresa edita o seu texto uma vez e todas as propostas novas
 * nascem com ele, sem deixar de se poder mudar dentro de cada proposta.
 */

const PROPOSAL_STANDARD = {
  "capa": {
    "slogan": "Energia que liga Angola."
  },
  "documento": {
    "tipo": "Proposta Técnica e Comercial"
  },
  "empresa": {
    "nome": "MBT ENERGIA",
    "contribuinte": "5 171 162 646",
    "registo_conservatoria": "nº 1566",
    "folha": "190 do Livro “C” – 4",
    "telefone": "(+244) 936 000 271",
    "email": "geral@mbtenergia.com",
    "morada_sede": "POLIS – Estrada da Zootécnica Km5 – Humpata, Huíla"
  },
  "sintese": {
    "inicio": "15 dias",
    "garantia": "3 anos"
  },
  "tracado": {
    "texto": "Os traçados dos ramais do Projeto foram definidos de acordo com as necessidades funcionais da instalação e em observância às condições topográficas e construtivas do terreno. Durante a conceção do traçado, foram considerados os seguintes critérios técnicos:",
    "criterios": [
      {
        "icone": "terrain",
        "titulo": "Adequação ao terreno e à edificação",
        "texto": "Os trajetos foram ajustados às características físicas do local, respeitando obstáculos estruturais e assegurando a integração com os elementos arquitetónicos."
      },
      {
        "icone": "gauge",
        "titulo": "Eficiência operacional",
        "texto": "Os percursos foram definidos de modo a reduzir quedas de tensão e minimizar interferências electromagnéticas, assegurando o desempenho adequado do sistema eléctrico."
      },
      {
        "icone": "wrench",
        "titulo": "Manutenibilidade",
        "texto": "O traçado irá priorizar soluções que permitem inspeção, identificação e substituição dos cabos, garantindo acessibilidade para intervenções futuras sem comprometer a estrutura."
      },
      {
        "icone": "link",
        "titulo": "Compatibilização com demais Projetos",
        "texto": "O encaminhamento das linhas foi coordenado com instalações hidráulicas, estruturais e de telecomunicações, evitando interferências e sobreposições."
      }
    ]
  },
  "quadro_colunas": [
    {
      "chave": "mt",
      "rotulo": "Rede MT",
      "unidade": "km",
      "icone": "pylon"
    },
    {
      "chave": "pt",
      "rotulo": "PT’s",
      "unidade": "un",
      "icone": "pt"
    },
    {
      "chave": "bt",
      "rotulo": "Rede BT",
      "unidade": "km",
      "icone": "bt"
    },
    {
      "chave": "lum",
      "rotulo": "Luminárias",
      "unidade": "un",
      "icone": "lamp"
    },
    {
      "chave": "lig",
      "rotulo": "Novas ligações",
      "unidade": "lig.",
      "icone": "home"
    }
  ],
  "execucao_trabalhos": [
    {
      "icone": "users",
      "texto": "Todos os trabalhos serão executados por <b>pessoal qualificado</b>, com solidez e perfeição no respeito pelas regras de boa arte, sendo a sua execução devidamente harmonizada e compatibilizada com todas as especialidades intervenientes."
    },
    {
      "icone": "clock",
      "texto": "Está prevista a realização dos trabalhos durante o horário normal de trabalho, <b>entre as 07h00 e as 17h00</b>."
    },
    {
      "icone": "tool",
      "texto": "A MBT colocará em obra os <b>equipamentos necessários</b> à boa execução dos trabalhos."
    }
  ],
  "qualidade_seguranca_ambiente": [
    "A MBT é uma empresa que desenvolve a sua actividade na área de engenharia de serviços com elevada incorporação tecnológica.",
    "A MBT tem em curso a implementação e manutenção do <b>Sistema da Qualidade, Segurança e Ambiente (SQSA)</b>, sendo encarada como uma ferramenta fundamental para a criação de valor acrescentado para todas as Empresas e Clientes que a escolhem como parceiro de negócio.",
    "O SQSA, descrito no Manual da Qualidade, Segurança e Ambiente, abrange todos os processos operacionais que afectam a Qualidade, Segurança e Ambiente e encontra-se estruturado de forma a dar especial importância às acções preventivas que evitem a ocorrência de potenciais problemas, sem, contudo, sacrificar a capacidade de resolução e correcção das falhas eventualmente verificadas."
  ],
  "exclusoes": [
    "Licenciamento dos trabalhos, vistorias, cortes de energia, autorizações, fiscalização e policiamento para a execução da obra;",
    "Mobilização/desmobilização de mão-de-obra e/ou equipamentos, por faseamento de obra e/ou por motivos não imputáveis à MBT;",
    "Eventuais interferências, retiradas, desvios/deslocações, suspensões e/ou manuseamento de quaisquer tipos de estruturas e/ou infraestruturas existentes, para além das directa e especificamente indicadas na nossa lista de quantidades;",
    "Qualquer fornecimento e instalação de materiais não estipulado na lista de quantidades;",
    "Fornecimento de materiais de equipamentos referente aos Projetos em causa."
  ],
  "comercial": {
    "nota_iva": "Os valores abaixo apresentados <b>não contemplam o IVA</b> (Imposto sobre o Valor Acrescentado).",
    "titulo_lista": "Lista de Preços",
    "regime": "O regime da empreitada, quanto ao modo de atribuição, será por <b>preço global</b>.",
    "pagamento": [
      {
        "destaque": "15%",
        "texto": "Pagamento inicial do valor total do CONTRATO, a ser deduzido em cada auto emitido."
      },
      {
        "destaque": "Autos mensais",
        "texto": "Com a apresentação e aprovação de Autos de Medição mensais dos trabalhos realizados."
      },
      {
        "destaque": "30 dias",
        "texto": "Prazo de pagamento das Faturas aprovadas, após a sua receção."
      },
      {
        "destaque": "Kwanzas",
        "texto": "Pagamentos por transferência bancária, para a conta bancária indicada na Fatura."
      }
    ],
    "garantia": {
      "titulo": "Garantia da Obra: 3 anos",
      "texto": "A garantia é dada ao cliente contra qualquer defeito verificado em obra que seja de má execução das equipas técnicas."
    }
  },
  "recepcao": "Logo que a obra esteja concluída, será efectuada uma vistoria com o objectivo de emitir o respectivo <b>Auto de Receção Provisória</b>, que será assinado pelos representantes de ambas as partes.",
  "validade": "A presente proposta tem a validade de <b>30 dias</b> após a data da sua assinatura ou data de envio por email.",
  "contactos": {
    "texto": "De forma a facilitar todos os contactos entre o Cliente e a MBT, informamos que todos os assuntos relacionados com esta proposta são coordenados por:",
    "pessoas": [
      {
        "cargo": "Diretor Geral",
        "nome": "Diogo Gomes",
        "telefone": "927 392 950"
      },
      {
        "cargo": "Coordenador de Obra",
        "nome": "José Gouveia",
        "telefone": "937 509 950"
      },
      {
        "cargo": "Coordenador de Projectos",
        "nome": "Euclides Cabenda",
        "telefone": "926 890 132"
      },
      {
        "cargo": "Coordenador de Produção",
        "nome": "Custódio Leopoldo",
        "telefone": "937 110 761"
      }
    ],
    "morada_profissional": "Av. 4 de Fevereiro nº 659 – Bairro Comercial<br>Lubango – Huíla – ANGOLA",
    "telefone": "00 244 261 225 262",
    "fax": "00 244 261 225 371",
    "fecho": "Ao vosso dispor para qualquer esclarecimento adicional, subscrevemo-nos atenciosamente.",
    "assinatura": {
      "nome": "Euclides Cabenda",
      "cargo": "Coordenador de Projectos"
    }
  },
  "cronograma_texto": "O cronograma de execução constitui um instrumento de planeamento e controlo que estabelece, de forma estruturada, as etapas e os prazos das actividades previstas no Projeto. A sua elaboração visa assegurar a adequada sequência das tarefas, a alocação eficiente dos recursos disponíveis e o acompanhamento sistemático do progresso da obra. Por meio deste cronograma, torna-se possível monitorizar o cumprimento dos marcos estabelecidos, identificar eventuais desvios e adoptar medidas correctivas, garantindo, assim, a execução ordenada e tempestiva do Projeto, em conformidade com os objectivos definidos.",
  "organograma_texto": "O organograma da obra representa a estrutura organizacional e hierárquica do Projeto, evidenciando as responsabilidades e a cadeia de comando durante a execução dos trabalhos. No âmbito da construção, o organograma evidencia a divisão de funções, a distribuição das equipas e o número de trabalhadores alocados a cada frente de serviço. Assim, garante uma gestão eficiente, organizada e com controlo em todas as fases de execução do Projeto.",
  "quadro_texto": "O quadro apresenta um resumo das obras de eletrificação em três localidades: Ukuma, Tchindjendje e Longonjo. Para cada localidade, são destacados os principais indicadores de infraestrutura eléctrica a serem executados."
};

/** A chave onde a empresa guarda a sua versão deste texto. */
const STANDARD_SETTING_KEY = "proposal.standard";

module.exports = { PROPOSAL_STANDARD, STANDARD_SETTING_KEY };
