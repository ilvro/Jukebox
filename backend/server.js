// requires npm installs
const express = require('express');
const ytdl = require('ytdl-core');
const cors = require('cors');

//
const fs = require('fs');
const path = require('path');

const app = express();
const port = 3000;

app.use(cors());

app.post('/echo', (req, res) => {
  const message = req.body.message;
  res.send(message);
})

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`)
})
