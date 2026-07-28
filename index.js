const express = require('express');
const cors = require('cors');
const app = express();
require('dotenv').config();
const port = process.env.PORT || 3000
// import { MongoClient } from 'mongodb';
const { MongoClient } = require('mongodb');

// middleware
app.use(express.json());
app.use(cors());

const client = new MongoClient(`mongodb+srv://${process.env.USERNAME_DB}:${process.env.PASSWORD_DB}@cluster0.kbxs8tk.mongodb.net/?appName=Cluster0`);

app.get('/', (req, res) => {
  res.send('Hello World recap full stack project!')
})

 async function connectToMongoDB() {
  try {
    await client.connect();

    const db = client.db('recapZapShiftDB');
    const parcelsCollection = db.collection('parcels')

    // parcels api
    app.post('/parcels', async(req, res) => {
        const parcel = req.body;
        const result = await parcelsCollection.insertOne(parcel);
        res.send(result)
    })

    app.get('/parcels', async(req, res) => {
        const query = {};
        const {email} = req.query;
        if(email){
            query.senderEmail = email;
        }
        const cursor = parcelsCollection.find(query);
        const result = await cursor.toArray();
        res.send(result);
    })

    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}
connectToMongoDB();

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})