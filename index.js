const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const port = process.env.PORT || 3000;
const stripe = require("stripe")(process.env.STRIPE_SECRET);
const { MongoClient, ObjectId } = require("mongodb");

// firebase theke
// new
const { initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

const serviceAccount = require("./recap-zap-shift-firebase-adminsdk.json");

initializeApp({
  credential: cert(serviceAccount),
});

// old
// const admin = require("firebase-admin");
// const serviceAccount = require("./recap-zap-shift-firebase-adminsdk.json");
// admin.initializeApp({
//   credential: admin.credential.cert(serviceAccount)
// });

const crypto = require("crypto");

function generateTrackingId() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");

  const randomPart = crypto.randomBytes(4).toString("hex").toUpperCase();

  return `TRK-${date}-${randomPart}`;
}

// middleware
app.use(express.json());
app.use(cors());

// jwt korar firebase middleware
const verifyFBToken = async (req, res, next) => {
  const token = req.headers.authorization;
  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  try {
    const idToken = token.split(" ")[1];
    const decoded = await getAuth().verifyIdToken(idToken);
    req.decoded_email = decoded.email;
    next();
  } catch (err) {
    return res.status(401).send({ message: "unauthorized access" });
  }
};

const client = new MongoClient(
  `mongodb+srv://${process.env.USERNAME_DB}:${process.env.PASSWORD_DB}@cluster0.kbxs8tk.mongodb.net/?appName=Cluster0`,
);

app.get("/", (req, res) => {
  res.send("Hello World recap full stack project!");
});

async function connectToMongoDB() {
  try {
    await client.connect();

    const db = client.db("recapZapShiftDB");
    const parcelsCollection = db.collection("parcels");
    const paymentCollection = db.collection("payment");
    const userCollection = db.collection("users");
    const ridersCollection = db.collection("riders");

    // middleware admin before allowing admin activity
    // must be used after verifyFBToken middleware
    const verifyAdmin = async(req, res, next) => {
      const email = req.decoded_email;
      const query = {email};
      const user = await userCollection.findOne(query);

      if(!user || user.role !== 'admin'){
        return res.status(403).send(({message : 'forbidden access'}))
      }

      next();
    }

    // users related apis
    app.post('/users', async(req, res) => {
      const user = req.body;
      user.role = 'user';
      user.createdAt = new Date();
      const email = user.email;
      const userExists = await userCollection.findOne({email})

      if(userExists){
        return res.send({message : 'user exists'})
      }

      const result = await userCollection.insertOne(user);
      res.send(result);
    })

    app.patch('/users/:id/role',verifyFBToken,verifyAdmin, async(req, res) => {
      const id = req.params.id;
      const roleInfo = req.body;
      const query = { _id : new ObjectId(id)};
      const updatedDoc = {
        $set:{
          role : roleInfo.role
        }
      };
      const result = await userCollection.updateOne(query, updatedDoc);
      res.send(result);
    })

    app.get('/users', async(req, res) => {
      const cursor =  userCollection.find().sort({createdAt : -1});
      const result = await cursor.toArray();
      res.send(result);
    })

    app.get('/users/:id', async(req, res) => {

    })

    app.get('/users/:email/role', async(req, res) => {
      const email = req.params.email;
      const query = {email};
      const user = await userCollection.findOne(query);
      res.send({role: user?.role || 'user'})
    })

    // riders related api
    app.get('/riders', async(req, res) => {
      const query = {};
      if(req.query.status){
        query.status = req.query.status;  
      }
      const cursor = ridersCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    })

    // rider ke approved karar patch api
    app.patch('/riders/:id', async(req, res) => {
      const status = req.body.status;
      const id = req.params.id;
      const query = {_id : new ObjectId(id)}
      const updatedDoc = {
        $set:{
          status : status 
        }
      }
      const result = await ridersCollection.updateOne(query, updatedDoc);

      if(status === 'approved'){
        const email = req.body.email;
        const userQuery = {email};
        const updateUser = {
          $set : {
            role : 'rider'
          }
        }
        const userResult = await userCollection.updateOne(userQuery, updateUser);
      }

      res.send(result);
    })

    app.post('/riders', async(req, res) => {
      const rider = req.body;
      rider.createdAt = new Date();
      rider.status = 'pending'
      const result = await ridersCollection.insertOne(rider);
      res.send(result);

    })

    app.delete('/riders/:id', async(req, res) => {
      const id = req.params.id;
      const query = {_id : new ObjectId(id)}
      const result = await ridersCollection.deleteOne(query);
      res.send(result)
    })

    // parcels api
    app.post("/parcels", async (req, res) => {
      const parcel = req.body;
      // created time
      parcel.createdAt = new Date();
      const result = await parcelsCollection.insertOne(parcel);
      res.send(result);
    });

    // payment karar samoy single parcel er data paoyar jonno get api
    app.get("/parcels/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await parcelsCollection.findOne(query);
      res.send(result);
    });

    app.get("/parcels", async (req, res) => {
      const query = {};
      const { email } = req.query;
      if (email) {
        query.senderEmail = email;
      }
      const option = { sort: { createdAt: -1 } };
      const cursor = parcelsCollection.find(query, option);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.delete("/parcels/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await parcelsCollection.deleteOne(query);
      res.send(result);
    });

    // stripe er jonno payment related api
    // same page theke karar jonno api
    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.cost) * 100;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "usd",
              unit_amount: amount,
              product_data: {
                name: `Please Pay For : ${paymentInfo.parcelName}`,
              },
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        metadata: {
          parcelId: paymentInfo.parcelId,
          parcelName: paymentInfo.parcelName,
        },
        customer_email: paymentInfo.senderEmail,
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
      });
      res.send({ url: session.url });
    });

    // success houyar por session id ta niye kaj korar jonno patch api
    app.patch("/payment-success", async (req, res) => {
      const sessionId = req.query.session_id;
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const transactionId = session.payment_intent;
      const query = { transactionId: transactionId };

      const paymentExist = await paymentCollection.findOne(query);
      console.log(paymentExist);

      if (paymentExist) {
        return res.send({
          message: "already exists",
          transactionId,
          trackingId: paymentExist.trackingId,
        });
      }

      const trackingId = generateTrackingId();

      if (session.payment_status === "paid") {
        const id = session.metadata.parcelId;
        const query = { _id: new ObjectId(id) };
        const update = {
          $set: {
            paymentStatus: "paid",
            trackingId: trackingId,
          },
        };
        const result = await parcelsCollection.updateOne(query, update);

        const payment = {
          amount: session.amount_total / 100,
          currency: session.currency,
          customerEmail: session.customer_email,
          parcelId: session.metadata.parcelId,
          parcelName: session.metadata.parcelName,
          transactionId: session.payment_intent,
          paymentStatus: session.payment_status,
          paidAt: new Date(),
          trackingId: trackingId,
        };

        if (session.payment_status === "paid") {
          const resultPayment = await paymentCollection.insertOne(payment);
          res.send({
            success: true,
            modifyParcel: result,
            paymentInfo: resultPayment,
            trackingId: trackingId,
            transactionId: session.payment_intent,
          });
        }
      }
      res.send({ success: false });
    });

    // payment history dekhanor get api
    app.get("/payments", verifyFBToken, async (req, res) => {
      const email = req.query.email;

      const query = {};

      if (email) {
        query.customerEmail = email;

        // check email address for jwt
        if (email !== req.decoded_email) {
          return res.status(403).send({ message: "forbidden access" });
        }
      }
      const cursor = paymentCollection.find(query).sort({paidAt:-1});
      const result = await cursor.toArray();
      res.send(result);
    });

    // old onno page theke korar jonno api
    // app.post("/create-checkout-session", async (req, res) => {
    //   const paymentInfo = req.body;
    //   const amount = parseInt(paymentInfo.cost) * 100;

    //   const session = await stripe.checkout.sessions.create({
    //     line_items: [
    //       {
    //         price_data: {
    //           currency: "usd",
    //           unit_amount: amount,
    //           product_data: {
    //             name: paymentInfo.parcelName,
    //           },
    //         },

    //         quantity: 1,
    //       },
    //     ],
    //     customer_email: paymentInfo.senderEmail,
    //     mode: "payment",
    //     metadata: {
    //       parcelId: paymentInfo.parcelId,
    //     },
    //     success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success`,
    //     cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
    //   });
    //   console.log(session);
    //   res.send({ url: session.url });
    // });

    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}
connectToMongoDB();

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
