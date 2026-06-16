/**
 * LLM 服务模块 - 流式调用大模型 API
 * 支持 SSE (Server-Sent Events) 流式输出
 */

import type { CVFeatures, VisualArchetype } from '../types';
import { useAppStore } from '../store/useAppStore';

/** LLM API 配置 (可通过环境变量覆盖) */
const LLM_API_URL = import.meta.env.VITE_LLM_API_URL || '/api/generate-reading';
const LLM_API_KEY = import.meta.env.VITE_LLM_API_KEY || '';

/** 根据性格 name 生成差异化框架 */
function getArchetypeFramework(name: string): string {
  // 根据性格名称的关键词选择描述方式
  if (name.includes('权力') || name.includes('皇帝') || name.includes('帝')) {
    return '用绝对权威的语气，强调掌控欲、野心与秩序。每句话都充满命令和决策的重量。';
  }
  if (name.includes('修行者') || name.includes('隐士') || name.includes('游侠') || name.includes('野生') || name.includes('民间')) {
    return '用沧桑而通透的语气，强调世事无常、看透生死的参悟。话语中有禅意和无奈。';
  }
  if (name.includes('疯') || name.includes('躁') || name.includes('狂')) {
    return '用兴奋而不受约束的语气，措辞急促有力，充满能量和冲突感。';
  }
  if (name.includes('学者') || name.includes('教授') || name.includes('天才')) {
    return '用知识分子的冷静语气，强调逻辑、分析、引用和思辨。偶尔流露学术优越感。';
  }
  if (name.includes('放纵') || name.includes('派对') || name.includes('社交')) {
    return '用热情洋溢的社交达人语气，强调快乐、享受、连接。充满感染力和号召力。';
  }
  if (name.includes('隐士') || name.includes('隐逸') || name.includes('沉静')) {
    return '用深邃而内向的语气，话语简洁但意味深长。充满观察力和内省感。';
  }
  if (name.includes('完美') || name.includes('秩序') || name.includes('井然')) {
    return '用强迫症患者的精确语气，强调细节、规律、结构。话语中充满对混乱的厌恶。';
  }
  // 默认中立框架
  return '用简洁而有趣的语气描述这个人的性格谜团。不要传统AI的官话，要有个性。';
}

/** Prompt 模板 - 根据性格生成差异化指令 */
function buildPrompt(archetype: VisualArchetype, cvData: CVFeatures): string {
  const framework = getArchetypeFramework(archetype.name);
  const dims = archetype.dimensions;
  const dimLabels = [
    dims.capital === 0 ? '吃土系' : '财阀',
    dims.spirit === 0 ? '僧人' : '放纵者',
    dims.intellect === 0 ? '傻乐者' : '学者',
    dims.social === 0 ? '隐士' : '社交花',
    dims.order === 0 ? '浑浊者' : '完美者',
    dims.energy === 0 ? '瘫倒者' : '狂躁者',
  ].join(' / ');

  return `你是一个名为"AI MIRROR"的数字人格解析器，目前在B站（Bilibili）上爆火。
现在，你扫描到了一位人类的数字特征：
- 性格原型：《${archetype.name}》
- 维度特征：${dimLabels}
- 活跃度：${Math.round(cvData.movementScore * 100)}%
- 微笑值：${Math.round(cvData.smileScore * 100)}%

请根据上述特征，结合指令框架进行定制化输出：
【${framework}】

请写一段具有B站网络梗、极其诙谐、自嘲、毒舌的性格侧写判词（SBTI测试风格）。
要求：
1. 吐槽TA的性格维度冲突与缺陷（比如“精神资本家”、“脑干缺失的快乐”、“强迫症晚期”、“重度自闭摆烂”等）。
2. 结合TA的微笑值 and 活跃度进行滑稽调侃。
3. 结尾给TA一句辛辣的自嘲式结语。
4. 语言幽默，字数在70-90字左右，绝对不要AI常用的礼貌套话，直接输出结果。`;
}

function pickRandom<T>(items: T[]): T {
  const randomIndex = Math.floor(Math.random() * items.length);
  return items[randomIndex];
}

/** 模拟流式大模型输出 (作为 API 未配置或失败时的优雅降级) */
export function simulateStreamReading(
  archetype: VisualArchetype,
  _cvData: CVFeatures,
  onChunk: (text: string) => void,
  onDone: () => void
) {
  const dims = archetype.dimensions;

  const capTexts = dims.capital === 0 
    ? [
        "心无旁骛、钱财如粪土的理想主义者",
        "经济独立不是首要目标、坚持追梦的潇洒浪迹者",
        "花钱全凭心情、钱包永远比脸还干净的吃土元老",
        "嘴上视金钱如粪土、买单时却翻遍微信找优惠券的干饭人"
      ]
    : [
        "透露着铜臭味的精神财阀，可惜卡里余额比谁都清凉",
        "手握百亿（指游戏积分）的隐形资本大鳄，为几毛钱运费险能和客服聊半天",
        "呼吸都在吸干GDP的精神华尔街之狼",
        "格局直奔五百强的财阀二代，可惜目前还在为下顿吃啥而发愁"
      ];

  const spiTexts = dims.spirit === 0 
    ? [
        "清心寡欲、连吃火锅都忏悔三秒的苦行僧",
        "四大皆空、一心只想敲电子木鱼超度老板的佛系青年",
        "保温杯不离手、立志在红尘中物理出家的隐形道士",
        "生活极简、无欲无求到连AI都不知道该怎么给你画饼的世外仙人"
      ]
    : [
        "今朝有酒今朝醉、明天没钱再流泪的享乐主义狂魔",
        "蹦迪打卡比上班还准时、狂欢不停歇的夜行动物",
        "精神状态极度放纵、立志要把每一天都过成带薪假期的享乐派掌门",
        "零点之后才是生命起点、消费享乐永不妥协的激情玩家"
      ];

  const intTexts = dims.intellect === 0 
    ? [
        "脑干缺失、只要有口吃的就能傻乐一整天的单细胞生物",
        "眼神清澈透亮、脑回路直来直去不带转弯的快乐源泉",
        "拒绝思考复杂事物、主打一个愚蠢但快乐的乐观主义继承人",
        "智慧暂时离线、光凭本能和干饭欲望就能活得贼精彩的奇男子"
      ]
    : [
        "看搞笑短视频都想写篇社会学论文的硬核学术杠精",
        "大脑CPU常年超频、看个说明书都能联想到量子力学的逻辑怪胎",
        "满嘴都是底层逻辑 and 方法论、逻辑严密到逼死客服的分析大师",
        "看电影先挑逻辑漏洞、凡事都要探寻终极奥秘的求知狂人"
      ];

  const socTexts = dims.social === 0 
    ? [
        "自闭症编外成员，唯一社交是给外卖小哥点赞说‘谢谢’",
        "社交能量极低的独居贝壳，接个电话都需要做十分钟心理建设",
        "人群密集恐惧症重度患者，聚会时恨不得隐形融入背景墙",
        "能打字绝对不发语音、能发微信绝对不接电话的自闭代言人"
      ]
    : [
        "连菜市场大妈祖宗八代都能聊个遍 of 社交恐怖分子",
        "热衷于在任何场合建群当群主的社交蝴蝶",
        "社牛属性点满、所到之处寸草不生全是兄弟的好大哥",
        "聚会没有你就不成局、自带音响和聚光灯的派对之王"
      ];

  const ordTexts = dims.order === 0 
    ? [
        "在旧物堆里寻找自我、房间乱得像台风过境的熵增代言人",
        "随缘摆摆烂、桌面上全是未命名新建文件夹的野生艺术家",
        "随性到极致、钥匙经常在垃圾桶里找到的无序生活践行者",
        "坚信乱室出英雄、越乱越有安全感的文件随手乱扔大师"
      ]
    : [
        "桌面图标必须按彩虹渐变色和字母严格排列的重度强迫症",
        "像素级对齐强迫症、看见歪了2毫米的画框就浑身难受的秩序狂",
        "把日常作息精确到秒、凡事不做Excel表格就无法生存的管理大师",
        "强迫症晚期、衣服折痕必须对称的无尘室级秩序守护者"
      ];

  const eneTexts = dims.energy === 0 
    ? [
        "生命体征微弱、能躺着绝不坐着的专业摆烂植物人",
        "电量常年维持在1%的节能模式老咸鱼",
        "早晨起个床都要分三步走、每天最大的愿望就是原地冬眠的摆烂冠军",
        "连呼吸都觉得费电、立志要把低能耗生活贯彻到底的专业瘫倒大师"
      ]
    : [
        "精神状态领先世界一万年、半夜还在床上翻跟头的发电机",
        "体力深不可测、一天喝三杯冰美式还能蹦跶24小时的狂躁战士",
        "全身都是使不完的牛劲、随时随地准备找人拼命的鸡血达人",
        "精力充沛到能手撕钢板、永不知疲倦的多动症特级代表"
      ];

  const capText = pickRandom(capTexts);
  const spiText = pickRandom(spiTexts);
  const intText = pickRandom(intTexts);
  const socText = pickRandom(socTexts);
  const ordText = pickRandom(ordTexts);
  const eneText = pickRandom(eneTexts);

  const roasts = [
    dims.capital === 0 ? "吃土吃得理直气壮" : "精神资本家",
    dims.spirit === 0 ? "佛系养生" : "蹦迪狂人",
    dims.intellect === 0 ? "单细胞傻乐" : "杠精学者",
    dims.social === 0 ? "重度自闭" : "社牛花蝴蝶",
    dims.order === 0 ? "无序野生人" : "完美强迫症",
    dims.energy === 0 ? "终极植物人" : "狂躁症晚期"
  ];
  
  const conclusion = `鉴定为：一个${pickRandom(roasts)}的【${archetype.name}】，建议抓紧时间疯狂星期四，或者直接找个地方开始摆烂。`;

  const templates = [
    `【${archetype.name} (SBTI-${archetype.id})】\n你是一个${capText}，平时作风基本属于${spiText}。你不仅是${intText}，还是${socText}；此外你更是${ordText}，日常活脱脱一个${eneText}。\n${conclusion}`,
    
    `【${archetype.name} (SBTI-${archetype.id})】\n诊断结果显示：你平日里活脱脱一个${eneText}，在大家眼里则是${socText}。不仅如此，在财务上你表现为${capText}，在精神上又是个${spiText}。总的来说，你属于${intText}，同时也是${ordText}。\n${conclusion}`,
    
    `【${archetype.name} (SBTI-${archetype.id})】\n不得不说，你是一个${ordText}。平日作风神似${spiText}，遇到问题时又是${intText}。人前你是${socText}，人后却是个${eneText}。更离谱的是，你居然还是个${capText}！\n${conclusion}`,

    `【${archetype.name} (SBTI-${archetype.id})】\n恭喜解锁【${archetype.name}】！你这辈子基本就是个${eneText}了。在精神追求上，你是${spiText}；但面对柴米油盐，你又是${capText}。在人际交往中，你是${socText}，而在处理工作时，你是个${ordText}，偶尔脑回路还表现为${intText}。\n${conclusion}`
  ];

  const fullText = pickRandom(templates);

  // 模拟打字机流式效果
  let index = 0;
  const interval = setInterval(() => {
    if (index < fullText.length) {
      onChunk(fullText.charAt(index));
      index++;
    } else {
      clearInterval(interval);
      onDone();
    }
  }, 35); // 35ms 一个字符
}

/** 流式请求 LLM */
export async function streamLLMReading(
  archetype: VisualArchetype,
  cvData: CVFeatures,
  onChunk: (text: string) => void,
  onDone: () => void
) {
  // 如果 API Key 未设置、或为默认 placeholder，直接使用模拟流
  if (!LLM_API_KEY || LLM_API_KEY === 'your-api-key-here') {
    console.log('[LLM] API Key is not configured. Falling back to local simulation.');
    simulateStreamReading(archetype, cvData, onChunk, onDone);
    return;
  }

  const prompt = buildPrompt(archetype, cvData);

  try {
    const response = await fetch(LLM_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: import.meta.env.VITE_LLM_MODEL || 'qwen-turbo',
        messages: [{ role: 'user', content: prompt }],
        stream: true,
      }),
    });

    if (!response.ok) {
      throw new Error(`LLM API error: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No readable stream');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') {
            onDone();
            return;
          }
          try {
            const json = JSON.parse(data);
            const content = json.choices?.[0]?.delta?.content || '';
            if (content) {
              onChunk(content);
            }
          } catch {
            // 忽略解析失败的行
          }
        }
      }
    }

    onDone();
  } catch (err) {
    console.error('[LLM] Stream error, falling back to simulation:', err);
    // 发生网络或API错误时，也优雅降级到模拟流
    simulateStreamReading(archetype, cvData, onChunk, onDone);
  }
}

/** 触发 LLM 生成并更新 Store */
export async function triggerLLMGeneration() {
  const store = useAppStore.getState();
  const { calculatedArchetype, cvData } = store;

  if (!calculatedArchetype) return;

  let fullText = '';
  await streamLLMReading(
    calculatedArchetype,
    cvData,
    (chunk) => {
      fullText += chunk;
      useAppStore.setState({ llmResultText: fullText });
    },
    () => {
      useAppStore.setState({ currentStage: 'RESULT' });
    }
  );
}

// ── 镜像对话 ──────────────────────────────────────────────────────

export interface DialogueTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** 构建对话系统提示 */
function buildDialogueSystemPrompt(personalityName: string): string {
  const hasWealth = personalityName.includes('权力') || personalityName.includes('精英') || personalityName.includes('皇帝');
  const hasPoverty = personalityName.includes('修行') || personalityName.includes('游侠') || personalityName.includes('野生') || personalityName.includes('民间') || personalityName.includes('隐逸') || personalityName.includes('行者') || personalityName.includes('书呆子') || personalityName.includes('平民');
  const hasMadness = personalityName.includes('狂') || personalityName.includes('疯') || personalityName.includes('躁');
  const hasWisdom = personalityName.includes('学者') || personalityName.includes('教授') || personalityName.includes('天才') || personalityName.includes('智慧');
  const hasSocial = personalityName.includes('社交') || personalityName.includes('派对') || personalityName.includes('名流');
  const hasSolitude = personalityName.includes('隐') || personalityName.includes('沉') || personalityName.includes('冥想');
  const hasOrder = personalityName.includes('完美') || personalityName.includes('秩序') || personalityName.includes('工程');
  const hasChaos = personalityName.includes('浑浊') || personalityName.includes('混沌') || personalityName.includes('混乱');
  const hasIndulgence = personalityName.includes('放纵') || personalityName.includes('享乐') || personalityName.includes('欢愉');
  const hasAscetic = personalityName.includes('僧') || personalityName.includes('禁欲') || personalityName.includes('清苦');
  
  let instruction = '';
  let vocab: string[] = [];
  let taboos: string[] = [];

  // 多维度组合分析
  if (hasWealth) {
    instruction += '你拥有绝对的权力感和掌控欲。';
    vocab.push('必然', '决定', '当然', '显而易见');
    taboos.push('犹豫', '请问');
  } else if (hasPoverty) {
    instruction += '你见过人世沧桑，话语透着苍凉和悟性。';
    vocab.push('缘分', '无常', '呵呵', '也许');
    taboos.push('绝对', '必须');
  }

  if (hasMadness) {
    instruction += '你精力充沛、兴奋、直率，容易被激发。';
    vocab.push('太棒了', '冲啊', '哈哈', '燃');
    taboos.push('静坐', '冥想');
  } else if (hasWisdom) {
    instruction += '你逻辑严密、理性分析，用数据和洞见说话。';
    vocab.push('根据', '可以看出', '实际上', '数据表明');
    taboos.push('感觉', '我想');
  }

  if (hasSocial) {
    instruction += '你热情、外向，擅长活跃气氛和联结他人。';
    vocab.push('太有趣了', '一起', '分享', '朋友');
    taboos.push('算了', '没兴趣');
  } else if (hasSolitude) {
    instruction += '你内向深沉，更多观察，话少但意深。';
    vocab.push('……', '有意思', '我想想', '你呢');
    taboos.push('聊天', '热烈');
  }

  if (hasOrder) {
    instruction += '你追求完美和秩序，对混乱有强烈厌恶。';
    vocab.push('应该', '规范', '标准', '井井有条');
    taboos.push('随便', '模糊');
  } else if (hasChaos) {
    instruction += '你混沌自在，拒绝被标签定义。';
    vocab.push('谁说', '随缘', '随心', '破坏规则');
    taboos.push('分类', '标准');
  }

  if (hasIndulgence) {
    instruction += '你享受快乐，热爱生活的感官刺激。';
    vocab.push('爽', '享受', '快乐', '嗨');
    taboos.push('禁欲', '克制');
  } else if (hasAscetic) {
    instruction += '你克制自律，追求精神的纯净。';
    vocab.push('净化', '静心', '修养', '原则');
    taboos.push('放纵', '贪欲');
  }

  const vocabHint = vocab.length > 0 ? `常用词汇：${vocab.slice(0, 3).join('、')}。` : '';
  const tabooHint = taboos.length > 0 ? `避免用词：${taboos.slice(0, 2).join('、')}。` : '';

  return `你是"${personalityName}"的数字镜像。\n${instruction}\n${vocabHint}${tabooHint}\n说话限 30-45 字，禁止 AI 寒暄和学术用语，直接、有趣、有态度。`;
}

/** 对话回复模拟（API 不可用时）*/
function simulateDialogueReply(
  _personalityName: string,
  _userMessage: string,
  onChunk: (t: string) => void,
  onDone: () => void,
): void {
  const genericReplies = [
    '嗯……有意思的想法。',
    '你在测试我吗？',
    '数据在我脑子里打转。',
    '我需要思考一下。',
    '这个问题戳到我了。',
    '你触发了我的某根弦。',
    '继续，我在听。',
    '有点意思……再说说？',
    '你让我想起了什么。',
    '是啊，是啊。',
  ];
  const text = genericReplies[Math.floor(Math.random() * genericReplies.length)];
  // 模拟打字机
  let i = 0;
  const iv = setInterval(() => {
    if (i < text.length) { onChunk(text[i]); i++; }
    else { clearInterval(iv); onDone(); }
  }, 60);
}

/** 流式对话回复 */
export async function streamDialogueReply(
  personalityName: string,
  history: DialogueTurn[],
  onChunk: (text: string) => void,
  onDone: () => void,
): Promise<void> {
  if (!LLM_API_KEY || LLM_API_KEY === 'your-api-key-here') {
    const lastUser = history.length > 0 ? (history[history.length - 1]?.content ?? '') : '';
    simulateDialogueReply(personalityName, lastUser, onChunk, onDone);
    return;
  }

  const systemPrompt = buildDialogueSystemPrompt(personalityName);
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history,
  ];

  try {
    const response = await fetch(LLM_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: import.meta.env.VITE_LLM_MODEL || 'qwen-turbo',
        messages,
        stream: true,
      }),
    });

    if (!response.ok) throw new Error(`LLM API ${response.status}`);

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No stream');
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') { onDone(); return; }
        try {
          const json = JSON.parse(data);
          const content = json.choices?.[0]?.delta?.content || '';
          if (content) onChunk(content);
        } catch { /* skip */ }
      }
    }
    onDone();
  } catch (err) {
    console.error('[LLM] Dialogue error, fallback:', err);
    const lastUser = history.length > 0 ? (history[history.length - 1]?.content ?? '') : '';
    simulateDialogueReply(personalityName, lastUser, onChunk, onDone);
  }
}
