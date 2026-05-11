const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const articles = [];
const comments = [];
const conversations = new Map();
const surveys = [];

const DIMENSIONS = [
  { key: 'perception', label: '知觉', lowTip: '试着每天写下1件自己做得好的小事，坚持21天', midTip: '保持觉察，遇到失败时用纸笔写下客观事实和主观感受分开看' },
  { key: 'attribution', label: '归因', lowTip: '下次遇到不顺时，画一个圆分两半：一半写自身原因，一半写环境原因', midTip: '练习用既...又...句式' },
  { key: 'decision', label: '决策', lowTip: '小决定用1分钟计时器，大决定列利弊清单限24小时', midTip: '不影响生命安全的事，快速决定比完美决定更重要' },
  { key: 'values', label: '价值观', lowTip: '写下10个你在乎的东西，逐个划掉，剩下3个', midTip: '每月末回顾，看看时间花在了你认为重要的事情上没有' },
  { key: 'attitude', label: '态度', lowTip: '用2分钟法则：如果2分钟内能做完，立刻做', midTip: '把大任务拆成最小可执行步骤，只要求自己完成第一步' },
  { key: 'efficacy', label: '自我效能感', lowTip: '回顾过去3次克服困难的经历，每次写一句我怎么做到的', midTip: '找一位榜样观察他如何克服类似困难' },
  { key: 'personality', label: '人格', lowTip: '向3个熟悉你的人询问你觉得我最大的3个优点是什么', midTip: '尝试在不同环境中做同一件事，观察哪种环境更自在' },
  { key: 'emotion', label: '情绪', lowTip: '每天用3个词记录情绪变化，给每种情绪打分1-10', midTip: '当情绪强烈时，先深呼吸6秒再反应，给自己一个暂停键' },
  { key: 'resilience', label: '压力与韧性', lowTip: '建立恢复清单：写下5件能让你快速恢复能量的小事', midTip: '每次经历挫折后写一段经验复盘' },
];

// Health
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// Chat with DeepSeek
let openaiClient = null;
function getClient() {
  if (!openaiClient) {
    const OpenAI = require('openai');
    openaiClient = new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY || '',
      baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
    });
  }
  return openaiClient;
}

app.post('/api/chat/send', async (req, res) => {
  const { message, conversationId } = req.body;
  if (!message) return res.status(400).json({ error: '消息不能为空' });
  let conv;
  if (conversationId && conversations.has(conversationId)) {
    conv = conversations.get(conversationId);
  } else {
    const id = uuidv4();
    conv = { id, title: message.slice(0, 50), messages: [], createdAt: new Date().toISOString() };
    conversations.set(id, conv);
  }
  const userMsg = { id: uuidv4(), role: 'user', content: message, timestamp: new Date().toISOString() };
  conv.messages.push(userMsg);
  try {
    const client = getClient();
    const history = conv.messages.slice(-10).map(m => ({ role: m.role, content: m.content }));
    const response = await client.chat.completions.create({
      model: 'deepseek-chat', messages: [
        { role: 'system', content: '你是心灵捕捉助手，一位温暖专业的AI心理陪伴者。先共情再引导，语言温暖自然，回复简洁在100-200字。' },
        ...history, { role: 'user', content: message }
      ], temperature: 0.8, max_tokens: 500,
    });
    const aiText = response.choices[0]?.message?.content || '抱歉，请稍后再试。';
    const aiMsg = { id: uuidv4(), role: 'assistant', content: aiText, timestamp: new Date().toISOString() };
    conv.messages.push(aiMsg);
    return res.json({ conversationId: conv.id, message: aiMsg });
  } catch (e) {
    console.error('DeepSeek error:', e.message);
    return res.status(500).json({ error: 'AI服务暂时不可用' });
  }
});

app.get('/api/chat/conversations', (_req, res) => {
  const list = Array.from(conversations.values()).map(c => ({ id: c.id, title: c.title, messageCount: c.messages.length, createdAt: c.createdAt }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return res.json(list);
});

app.get('/api/chat/conversations/:id', (req, res) => {
  const conv = conversations.get(req.params.id);
  if (!conv) return res.status(404).json({ error: '不存在' });
  return res.json(conv);
});

// Articles CRUD
app.get('/api/articles', (_req, res) => {
  const list = [...articles].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(({ content, ...rest }) => ({ ...rest, commentCount: comments.filter(c => c.articleId === rest.id).length }));
  return res.json(list);
});

app.get('/api/articles/:id', (req, res) => {
  const a = articles.find(a => a.id === req.params.id);
  if (!a) return res.status(404).json({ error: '不存在' });
  a.readCount += 1;
  return res.json({ ...a, commentCount: comments.filter(c => c.articleId === a.id).length });
});

app.post('/api/articles', (req, res) => {
  const { title, summary, content, category, tags, author } = req.body;
  if (!title || !content) return res.status(400).json({ error: '标题和内容不能为空' });
  const now = new Date().toISOString();
  const a = { id: uuidv4(), title, summary: summary || content.slice(0, 150), content, author: author || '匿名', category: category || '未分类', tags: tags || [], readCount: 0, createdAt: now, updatedAt: now };
  articles.push(a);
  return res.status(201).json(a);
});

app.put('/api/articles/:id', (req, res) => {
  const idx = articles.findIndex(a => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '不存在' });
  const { title, summary, content, category, tags, author } = req.body;
  if (title !== undefined) articles[idx].title = title;
  if (summary !== undefined) articles[idx].summary = summary;
  if (content !== undefined) articles[idx].content = content;
  if (category !== undefined) articles[idx].category = category;
  if (tags !== undefined) articles[idx].tags = tags;
  if (author !== undefined) articles[idx].author = author;
  articles[idx].updatedAt = new Date().toISOString();
  return res.json(articles[idx]);
});

app.delete('/api/articles/:id', (req, res) => {
  const idx = articles.findIndex(a => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '不存在' });
  articles.splice(idx, 1);
  return res.json({ success: true });
});

// Comments
app.get('/api/articles/:articleId/comments', (req, res) => {
  const list = comments.filter(c => c.articleId === req.params.articleId)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  return res.json(list);
});

app.post('/api/articles/:articleId/comments', (req, res) => {
  const { author, content } = req.body;
  if (!content) return res.status(400).json({ error: '内容不能为空' });
  const c = { id: uuidv4(), articleId: req.params.articleId, author: author || '匿名', content, createdAt: new Date().toISOString() };
  comments.push(c);
  return res.status(201).json(c);
});

app.delete('/api/comments/:id', (req, res) => {
  const idx = comments.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '不存在' });
  comments.splice(idx, 1);
  return res.json({ success: true });
});

// Survey
app.get('/api/survey/dimensions', (_req, res) => res.json(DIMENSIONS));

app.post('/api/survey/submit', (req, res) => {
  const { scores, wantContact, contact } = req.body;
  if (!scores || Object.keys(scores).length !== 9) return res.status(400).json({ error: '请完成全部9题' });
  const totalScore = Object.values(scores).reduce((sum, v) => sum + Number(v), 0);
  const result = { id: uuidv4(), scores, totalScore, wantContact: !!wantContact, contact: wantContact ? (contact || '') : '', createdAt: new Date().toISOString() };
  surveys.push(result);
  const dimensions = DIMENSIONS.map(d => ({ ...d, score: Number(scores[d.key]) || 0, level: (Number(scores[d.key]) || 0) < 3 ? 'low' : (Number(scores[d.key]) || 0) <= 4 ? 'mid' : 'high' }));
  return res.json({ id: result.id, totalScore, maxScore: 45, dimensions });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log('Server running on port ' + PORT));
