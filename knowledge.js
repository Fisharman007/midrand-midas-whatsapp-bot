// Knowledge base — add/edit entries here. No code changes needed.
// Each entry has: topic, question, answer, keywords (for matching).

const KNOWLEDGE = [
  // ── BATTERY PERFORMANCE ──────────────────────────────────────────────────
  {
    id: 'perf-voltage-capacity',
    topic: 'Battery Performance',
    question: 'How do you measure a battery\'s performance?',
    answer:
      'Battery performance is measured by two key parameters:\n\n' +
      '*Voltage* — the force driving electrons out of the battery. For lead-acid cells the typical open-circuit voltage is ~2.13V, with a nominal 2.00V per cell (giving 6V, 12V, etc.).\n\n' +
      '*Capacity (Ah)* — the total charge the battery can deliver, measured in ampere-hours. A 60Ah battery can supply 6A for 10 hours, for example.',
    keywords: ['measure', 'performance', 'voltage', 'capacity', 'ampere', 'ah', 'volts', 'how does a battery work'],
  },

  // ── LEISURE BATTERIES ────────────────────────────────────────────────────
  {
    id: 'leisure-what-is',
    topic: 'Leisure Batteries',
    question: 'What is a leisure battery?',
    answer:
      'A leisure battery is a deep-cycle battery designed to provide a steady, reliable power source for recreational vehicles (RVs), caravans, boats, and other leisure applications — powering lighting, appliances, and electronics when external power is unavailable.',
    keywords: ['leisure', 'deep cycle', 'caravan', 'boat', 'rv', 'motorhome', 'camping', 'recreational'],
  },
  {
    id: 'leisure-vs-car',
    topic: 'Leisure Batteries',
    question: 'How does a leisure battery differ from a car battery?',
    answer:
      'Leisure batteries are built for *deep cycling* — discharging a significant portion of their capacity before recharging — and have thicker plates to sustain long power delivery.\n\n' +
      'Car batteries are designed for short, high-power bursts to start an engine, not sustained discharge.',
    keywords: ['leisure', 'difference', 'car battery', 'deep cycle', 'compare', 'vs'],
  },
  {
    id: 'leisure-uses',
    topic: 'Leisure Batteries',
    question: 'What are common uses for a leisure battery?',
    answer:
      'Leisure batteries power lights, refrigerators, TVs, sound systems, water pumps, and other electrical devices in boats, motorhomes, caravans, and camping setups.',
    keywords: ['leisure', 'uses', 'what can', 'power', 'fridge', 'lights', 'camping'],
  },
  {
    id: 'leisure-car-as-leisure',
    topic: 'Leisure Batteries',
    question: 'Can I use a car battery as a leisure battery?',
    answer:
      'While possible as a temporary fix, it is *not recommended*. Car batteries are not designed for deep cycling — repeated deep discharges will significantly shorten their lifespan.',
    keywords: ['car battery', 'leisure', 'substitute', 'use instead', 'replace', 'temporary'],
  },
  {
    id: 'leisure-charging',
    topic: 'Leisure Batteries',
    question: 'How do I charge a leisure battery?',
    answer:
      'You can charge a leisure battery using:\n' +
      '• A dedicated leisure battery charger (recommended)\n' +
      '• Your vehicle\'s alternator while driving\n' +
      '• Solar panels\n\n' +
      'Always follow the manufacturer\'s instructions and use a charger compatible with your battery type to avoid over- or under-charging.',
    keywords: ['leisure', 'charge', 'charging', 'solar', 'alternator', 'charger'],
  },
  {
    id: 'leisure-maintenance',
    topic: 'Leisure Batteries',
    question: 'How do I maintain a leisure battery?',
    answer:
      'Key maintenance steps:\n' +
      '• Keep terminals clean and free of corrosion\n' +
      '• Check electrolyte levels if applicable\n' +
      '• Store in a cool, dry, well-ventilated place\n' +
      '• Avoid deep discharges — recharge before the battery is fully flat',
    keywords: ['leisure', 'maintain', 'maintenance', 'care', 'terminal', 'electrolyte', 'store'],
  },
  {
    id: 'leisure-recharge-frequency',
    topic: 'Leisure Batteries',
    question: 'How often should I recharge my leisure battery?',
    answer:
      'Recharge frequency depends on usage and how much capacity has been used. As a rule: *recharge before the battery fully discharges*. Letting a leisure battery sit fully flat causes sulphation and permanently reduces capacity.',
    keywords: ['leisure', 'how often', 'recharge', 'frequency', 'when to charge'],
  },

  // ── AUTOMOTIVE BATTERY ROLE ──────────────────────────────────────────────
  {
    id: 'auto-purpose',
    topic: 'Automotive Batteries',
    question: 'What does a car battery do?',
    answer:
      'A car battery has three main jobs:\n' +
      '1. *Start the engine* — supplies the burst of power needed to crank the starter motor\n' +
      '2. *Backup power* — keeps the car running if the alternator fails\n' +
      '3. *Electrical systems* — powers lights, radio, and accessories when the engine is off\n\n' +
      '_Start/Stop vehicles require AGM or EFB batteries — standard batteries cannot handle the constant cycling._',
    keywords: ['purpose', 'what does', 'function', 'role', 'car battery', 'how does it work', 'what is'],
  },

  // ── DIAGNOSTICS ──────────────────────────────────────────────────────────
  {
    id: 'diag-failure-causes',
    topic: 'Diagnostics',
    question: 'What causes a car battery to fail?',
    answer:
      'Common causes of battery failure:\n' +
      '• *Age* — most batteries last 3–5 years\n' +
      '• *Extreme temperatures* — heat accelerates plate corrosion; cold reduces capacity\n' +
      '• *Parasitic drain* — leaving lights or accessories on\n' +
      '• *Short trips* — the alternator never fully recharges the battery\n' +
      '• *Electrical faults* — charging system problems',
    keywords: ['fail', 'failure', 'cause', 'why', 'dead', 'problem', 'issue', 'old'],
  },
  {
    id: 'diag-replacement-signs',
    topic: 'Diagnostics',
    question: 'How do I know when to replace my battery?',
    answer:
      'Replace your battery if you notice:\n' +
      '• *Hard starting* or slow cranking\n' +
      '• *Dim headlights*, especially at idle\n' +
      '• A bloated, cracked, or leaking casing\n' +
      '• The battery is *3–5+ years old*\n' +
      '• Repeated need for jump-starts\n\n' +
      '_Bring your vehicle in and we can test the battery for free — call *(010) 746 6260*._',
    keywords: ['replace', 'replacement', 'when', 'new battery', 'signs', 'symptoms', 'how do i know', 'test'],
  },
  {
    id: 'diag-intermittent-start',
    topic: 'Diagnostics',
    question: 'Why does my car only start sometimes?',
    answer:
      'Intermittent starting is usually caused by:\n' +
      '• A weak or dying battery\n' +
      '• Loose or corroded terminal connections\n' +
      '• A faulty starter motor or solenoid\n' +
      '• A malfunctioning ignition switch\n' +
      '• Broader electrical system issues\n\n' +
      '_We recommend having the battery and charging system tested — call us on *(010) 746 6260*._',
    keywords: ['sometimes', 'intermittent', 'not starting', 'wont start', 'won\'t start', 'random', 'occasionally'],
  },

  // ── MAINTENANCE & CHARGING ───────────────────────────────────────────────
  {
    id: 'maint-routine',
    topic: 'Maintenance',
    question: 'How do I maintain my car battery?',
    answer:
      'Routine battery maintenance:\n' +
      '• Clean terminals regularly — remove any white/blue corrosion\n' +
      '• Check and tighten cable connections\n' +
      '• Check electrolyte levels if it\'s a serviceable battery\n' +
      '• Inspect the casing for cracks or swelling',
    keywords: ['maintain', 'maintenance', 'care', 'clean', 'terminal', 'corrosion', 'look after'],
  },
  {
    id: 'maint-charging',
    topic: 'Maintenance',
    question: 'How do I charge my car battery?',
    answer:
      'Use a *dedicated battery charger* connected to mains power, following the manufacturer\'s instructions. Make sure the charger is compatible with your battery type (standard, AGM, or EFB). Always charge in a well-ventilated area.',
    keywords: ['charge', 'charging', 'charger', 'flat battery', 'dead battery', 'recharge'],
  },
  {
    id: 'maint-sitting-unused',
    topic: 'Maintenance',
    question: 'How long can a battery sit unused?',
    answer:
      'It depends on the battery\'s type, age, and temperature. Generally a fully charged battery can sit for *several weeks to a few months* before going flat. To preserve it during storage, use a trickle/maintenance charger.',
    keywords: ['sit', 'unused', 'storage', 'store', 'parked', 'long time', 'holiday', 'weeks', 'months'],
  },

  // ── SAFETY & INSTALLATION ────────────────────────────────────────────────
  {
    id: 'safety-explosion',
    topic: 'Safety',
    question: 'Can a battery explode?',
    answer:
      'While rare, yes — a battery can explode if it is severely overcharged, short-circuited, or physically damaged. To minimise risk: never smoke near a battery, avoid sparks, and ensure good ventilation when charging.',
    keywords: ['explode', 'explosion', 'dangerous', 'safe', 'risk', 'hazard'],
  },
  {
    id: 'safety-handling',
    topic: 'Safety',
    question: 'How do I safely handle a car battery?',
    answer:
      '• Wear *protective gloves and eye protection*\n' +
      '• No smoking, open flames, or sparks nearby\n' +
      '• Ensure good ventilation\n' +
      '• Handle carefully — batteries are heavy and contain acid',
    keywords: ['handle', 'safety', 'safe', 'gloves', 'protective', 'acid', 'hazard'],
  },
  {
    id: 'safety-installation',
    topic: 'Safety',
    question: 'How do I replace / install a car battery?',
    answer:
      '*Step-by-step battery replacement:*\n\n' +
      '1. Turn the engine *completely off*\n' +
      '2. Disconnect *Negative (Black / —)* cable first\n' +
      '3. Disconnect *Positive (Red / +)* cable\n' +
      '4. Remove brackets/fasteners and lift out the old battery\n' +
      '5. Place the new battery and secure it\n' +
      '6. Connect *Positive (Red / +)* first\n' +
      '7. Connect *Negative (Black / —)* last\n\n' +
      '_⚠️ Always disconnect Negative first and connect Negative last to avoid shorts._',
    keywords: ['install', 'installation', 'replace', 'replacement', 'how to', 'fit', 'change', 'swap', 'diy', 'steps'],
  },
];

/**
 * Search the knowledge base by keyword relevance.
 * Returns top N entries scored by how many query words match keywords/question/topic.
 */
function searchKnowledge(query, topN = 3) {
  if (!query) return [];
  const words = query.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);

  const scored = KNOWLEDGE.map(entry => {
    const haystack = [
      entry.question.toLowerCase(),
      entry.topic.toLowerCase(),
      entry.answer.toLowerCase(),
      ...entry.keywords,
    ].join(' ');

    let score = 0;
    for (const word of words) {
      if (word.length < 3) continue;
      if (haystack.includes(word)) score++;
    }
    return { entry, score };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map(s => ({ topic: s.entry.topic, question: s.entry.question, answer: s.entry.answer }));
}

module.exports = { searchKnowledge };
