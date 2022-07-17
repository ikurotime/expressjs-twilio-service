if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}
import bodyParser from "body-parser";
import express from "express";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseToken = process.env.SUPABASE_ANON_KEY;
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE;

const supabase = createClient(supabaseUrl!, supabaseServiceRole!);
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const twilioApiKey = process.env.TWILIO_API_KEY;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioApiSecret = process.env.TWILIO_API_SECRET;

const client = require('twilio')(accountSid, authToken);
const AccessToken = require('twilio').jwt.AccessToken;
const ChatGrant = AccessToken.ChatGrant;

var cors = require('cors')

const app = express();
const port = process.env.PORT || 3333;
const addToDatabase = async (database: string,query: any) => {
  const {data,error} = await supabase.from(database).insert([ query ])
  console.log(data)
  console.log(error)
}

app.use(cors())
app.use(bodyParser.json());
app.use(bodyParser.raw({ type: "application/vnd.custom-type" }));
app.use(bodyParser.text({ type: "text/html" }));

// Create server
app.get("/create-server", async (req, res) => {
  const access_token = req.headers?.access_token as string
  if(!access_token.startsWith('anonymous')){
    supabase.auth.setAuth(access_token)
  }
  
  const { data,error } = await supabase
  .from('servers')
  .select('friendly_name').eq('friendly_name', req.headers?.friendlyname)
  console.log(data)
  console.log(error)
  if(data!.length > 0) return res.status(403).send('Server already exists')

  let identity:string;
  console.log(access_token)
  if (access_token.startsWith('anonymous')) {
		identity = access_token.split('_')[1];
	} else {
		const { data } = await supabase.auth.api.getUser(access_token);
		identity = data?.user_metadata.full_name;
	}
  client.conversations.v1.services.create({friendlyName: req.headers?.friendlyname, uniqueName: req.headers?.uniquename})
  .then(async (service: { sid: string; }) => {
    try {
      addToDatabase('servers',{ friendly_name: req.headers.friendlyname,unique_name: req.headers.uniquename, SID: service.sid,created_by: req.headers.uid })
    } catch (error) {
      res.send(error)
    }
    try {
      client.conversations.v1.services(service.sid)
      .conversations
      .create({uniqueName:'general',friendlyName:'general'}).then(async (conversation: { sid: string; }) => {
        try {
          await client.conversations.v1.services(service.sid)
          .conversations(conversation.sid)
          .participants
          .create({identity})
          await addToDatabase('server_members', { user_id: req.headers.uid, server_id: service.sid })
          await addToDatabase('channels',  { channel_id: conversation.sid,created_by:req.headers?.uid, server_id: service.sid,friendly_name: 'general' })
          addToDatabase('channel_members', { user_id: req.headers.uid, channel_id: conversation.sid,server_id: service.sid })
        res.send({ serverSid: service.sid, conversation: conversation })

        } catch (error) {
          res.send(error)
        }
      }
      )
    } catch (error) {
      res.send(error)
    }
  }); 
});

// Get access-token
app.get("/get-access-token", async (req, res) => {
  const jwt = req.headers?.jwt as string
	const SERVICE_SID = req.headers?.serversid as string

	if (jwt == null) {
		return res.status(401)
	}
	let identity;
	/* We try to get the identity from the jwt in order to make a new jwt with Twilio
		 if the user is not anonymous we can get the identity directly from Supabase
	*/
	if (jwt.startsWith('anonymous')) {
		identity = jwt.split('_')[1];
	} else {
    console.log(jwt)
		const { data } = await supabase.auth.api.getUser(jwt);
		identity = data?.user_metadata.full_name;
	}

	if (identity == null )return res.status(401)

	const accessToken = new AccessToken(accountSid, twilioApiKey, twilioApiSecret, {
		identity
	});
  console.log(accessToken)
	const conversationGrant = new ChatGrant({
		serviceSid: SERVICE_SID
	});
	accessToken.addGrant(conversationGrant);

  return res.status(200).send({
    accessToken: accessToken.toJwt(),
    identity
  });
})
// Get User Conversations
app.get("/get-user-conversations", async (req, res) => {
  const { data } = await supabase
  .from('servers')
		.select('friendly_name, id, channels(friendly_name, channel_id)')
    .eq('id', req.headers?.serversid)
  if(data!.length == 0) return res.status(403).send('User is not a member of any server')
  const channels: string[] = [];
  data![0].channels.forEach((channel:{channel_friendly_name:string,channel_sid:string}) => {
    channels.push(channel.channel_sid)
  });
  const conversations: any[] = [];
  channels.map(async (channel:string) => {
    await client.conversations.v1.services(req.headers.serversid).conversations(channel)
    .fetch()
    .then((conversation: any) => {
      conversations.push(conversation)
      res.status(200).send(conversations)
    })});
})
// Get all servers
app.get("/get-all-servers", async (req, res) => {
  client.conversations.v1.services.list().then((services: { sid: string; }) => res.send(services)); 
})
// Get user servers

// Add participant
app.get("/add-participant", async (req, res) => {
  console.log('serversid:' ,req.headers.serversid)
  console.log('conversationsid: ',req.headers.conversationsid)
  console.log('identity:' ,req.headers.identity)
  client.conversations.v1.services(req.headers?.serversid).conversations(req.headers?.conversationsid).participants.create({identity: req.headers?.identity})
  addToDatabase('server_members', { user_id: req.headers.uid, server_id: req.headers?.serversid})
  addToDatabase('channel_members', { user_id: req.headers?.uid, channel_id: req.headers?.conversationsid, server_id: req.headers?.serversid })
  res.status(200).send()
})

app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`);
});
