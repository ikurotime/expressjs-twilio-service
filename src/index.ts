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
const removeFromDatabase = async (database: string,query: any) => {
  const {data,error} = await supabase.from(database).delete(query)
  console.log(data)
  console.log(error)
}

app.use(cors())
app.use(bodyParser.json());
app.use(bodyParser.raw({ type: "application/vnd.custom-type" }));
app.use(bodyParser.text({ type: "text/html" }));

// Create server
app.post("/create-server", async (req, res) => {
  console.log(req.body)

  const access_token = req.body?.access_token as string
  if(!access_token.startsWith('anonymous')){
    supabase.auth.setAuth(access_token)
  }
  
  const { data,error } = await supabase
  .from('servers')
  .select('friendly_name').eq('friendly_name', req.body?.friendlyName)
  console.log(data)
  console.log(error)
  if(data!.length > 0) return res.status(403).send('Server already exists')

  let identity:string;

  if (access_token.startsWith('anonymous')) {
		identity = access_token.split('anonymous_')[1];
	} else {
		const { data } = await supabase.auth.api.getUser(access_token);
		identity = data?.user_metadata.full_name;
	}
  client.conversations.v1.services.create({friendlyName: req.body?.friendlyName, uniqueName: req.body?.uniqueName})
  .then(async (service: { sid: string; }) => {
    try {
      const invitationCode = Math.random().toString(16).substring(2, 8) + Math.random().toString(16).substring(2, 8);

      await addToDatabase('servers',{ friendly_name: req.body.friendlyName,unique_name: req.body.uniqueName, id: service.sid, invite_code: invitationCode})
    } catch (error) {
      res.send(error)
    }
    await addToDatabase('server_members', { user_id: req.body.uid, server_id: service.sid })
    try {
      client.conversations.v1.services(service.sid)
      .conversations
      .create({uniqueName:'presentations',friendlyName:'presentations'}).then(async (conversation: { sid: string; }) => {
        try {
          await client.conversations.v1.services(service.sid)
          .conversations(conversation.sid)
          .participants
          .create({identity})

          await addToDatabase('channels',  { id: conversation.sid, server_id: service.sid,friendly_name: 'presentations', description: 'Present yourself. Nice to meet you!' })
          await addToDatabase('channel_members', { user_id: req.body.uid, channel_id: conversation.sid,server_id: service.sid })
        } catch (error) {
          res.send(error)
        }
      }
      )
    } catch (error) {
      res.send(error)
    }
    try {
      client.conversations.v1.services(service.sid)
      .conversations
      .create({uniqueName:'coding',friendlyName:'coding'}).then(async (conversation: { sid: string; }) => {
        try {
          await client.conversations.v1.services(service.sid)
          .conversations(conversation.sid)
          .participants
          .create({identity})
          await addToDatabase('channels',  { id: conversation.sid, server_id: service.sid,friendly_name: 'coding', description: 'Lets talk about #programming' })
          await addToDatabase('channel_members', { user_id: req.body.uid, channel_id: conversation.sid,server_id: service.sid })

        } catch (error) {
          res.send(error)
        }
      }
      )
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
          await addToDatabase('channels',  { id: conversation.sid, server_id: service.sid,friendly_name: 'general', description: 'You can talk about everything here!' })
          await addToDatabase('channel_members', { user_id: req.body.uid, channel_id: conversation.sid,server_id: service.sid })
          //wait two seconds to make sure the channel is created
          setTimeout(() => {
             res.send({ serverSid: service.sid, conversation: conversation })
          }, 1000);
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
// Delete server
app.post("/delete-server", async (req, res) => {
  await supabase.from('channel_members').delete().match({ server_id: req.body?.serverSid })
  await supabase.from('channels').delete().match({ server_id: req.body?.serverSid })
  await supabase.from('server_members').delete().match({ server_id: req.body?.serverSid })

  client.conversations.v1.services(req.body?.serverSid).remove();
  res.status(200).send()
})
// Get access-token
app.post("/get-access-token", async (req, res) => {
  console.log(req.body)
  const jwt = req.body?.jwt as string
	const SERVICE_SID = req.body?.serverSid as string

	if (jwt == null) {
		return res.status(401)
	}
	let identity;
	/* We try to get the identity from the jwt in order to make a new jwt with Twilio
		 if the user is not anonymous we can get the identity directly from Supabase
	*/
	if (jwt.startsWith('anonymous')) {
		identity = jwt.split('anonymous_')[1];
	} else {
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
// Create channel
app.post("/create-channel", async (req, res) => {
  const serversid = req.body?.serverSid as string
  const channelname = req.body?.channelName as string
  const channeldescription = req.body?.channelDescription as string
  client.conversations.v1.services(serversid)
  .conversations
  .create({uniqueName:channelname,friendlyName:channelname})
  .then(async (conversation: { sid: string; }) => {
    try {
      await addToDatabase('channels',  { id: conversation.sid, server_id: serversid,friendly_name: channelname, description: channeldescription })
      // get members of server
      const { data } = await supabase.from('server_members').select('user_id').match({ server_id: serversid })
      res.send({ conversation: conversation })
    } catch (error) {
      res.send(error)
    }
  }
  )
})
// Get User Conversations
app.post("/get-user-conversations", async (req, res) => {
  console.log(req.body)

  const { data } = await supabase
  .from('servers')
		.select('friendly_name, id, channels(friendly_name,id)')
    .eq('id', req.body?.serversid)
  if(data!.length == 0) return res.status(403).send('User is not a member of any server')
  const channels: string[] = [];
  data![0].channels.forEach((channel:{channel_friendly_name:string,channel_sid:string}) => {
    channels.push(channel.channel_sid)
  });
  const conversations: any[] = [];
  channels.map(async (channel:string) => {
    await client.conversations.v1.services(req.body.serversid).conversations(channel)
    .fetch()
    .then((conversation: any) => {
      conversations.push(conversation)
      res.status(200).send(conversations)
    })});
})
// Get all servers
app.post("/get-all-servers", async (req, res) => {
  console.log(req.body)

  client.conversations.v1.services.list().then((services: { sid: string; }) => res.send(services)); 
})
// Get user servers

// Add participant
app.post("/add-participant", async (req, res) => {
  console.log(req.body)

  console.log('serverSid:' ,req.body.serverSid)
  console.log('conversationsid: ',req.body.conversationSid)
  console.log('identity:' ,req.body.identity)
  await addToDatabase('server_members', { user_id: req.body.uid, server_id: req.body?.serverSid})
  //get all channels from server
  const { data } = await supabase.from('channels').select('id').match({ server_id: req.body?.serverSid })
  data!.forEach(async (channel: { id: string; }) => {
    client.conversations.v1.services(req.body?.serverSid).conversations(channel.id).participants.create({identity: req.body?.identity})
    await addToDatabase('channel_members', { user_id: req.body.uid, channel_id: channel.id,server_id: req.body?.serverSid })
  }
  )
  //wait two seconds to make sure the channel is created
  setTimeout(() => {
  res.status(200).send()
  }, 1000);
})

// Remove participant
app.post("/remove-participant", async (req, res) => {
  console.log(req.body)

  console.log('serverSid:' ,req.body.serverSid)
  console.log('conversationsid: ',req.body.conversationSid)
  console.log('identity:' ,req.body.identity)
  client.conversations.v1.services(req.body?.serverSid).conversations(req.body?.conversationSid).participants.remove({identity: req.body?.identity})
  removeFromDatabase('server_members', { user_id: req.body.uid, server_id: req.body?.serverSid})
  removeFromDatabase('channel_members', { user_id: req.body?.uid, channel_id: req.body?.conversationSid, server_id: req.body?.serverSid })
  res.status(200).send()
})


app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`);
});
