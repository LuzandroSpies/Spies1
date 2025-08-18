const express = require('express');
const session = require('express-session');
const OpenAI = require('openai');
const config = require('./config.json');

const app = express();

app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'change-this-secret',
  resave: false,
  saveUninitialized: true
}));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.get('/', (req, res) => {
  res.render('home', {
    products: config.products,
    brands: config.brands,
    session: req.session
  });
});

app.post('/purchase/:id', (req, res) => {
  // Payment processing would occur here in a real app.
  req.session.hasPurchased = true;
  req.session.productId = req.params.id;
  res.redirect('/plan');
});

app.get('/plan', (req, res) => {
  if (!req.session.hasPurchased) return res.redirect('/');
  res.render('plan_form');
});

app.post('/plan', async (req, res) => {
  if (!req.session.hasPurchased) return res.redirect('/');
  const input = req.body;

  let plan = 'Set OPENAI_API_KEY to generate an AI-powered plan.';
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'You are a fitness and nutrition expert producing personalized meal and workout plans.' },
        { role: 'user', content: `Client data: ${JSON.stringify(input)}` }
      ]
    });
    plan = completion.choices[0].message.content.trim();
  } catch (err) {
    console.error(err);
  }

  res.render('plan_result', { plan });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
