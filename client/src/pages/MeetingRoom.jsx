import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { dummyMeetingDetails, dummyUser } from '../assets/asset'
import VideoGrid from '../components/meeting/VideoGrid'
import {useWebRTC} from '../hooks/useWebRTC'
import ChatPanel from '../components/meeting/ChatPanel'
import { useChat } from '../hooks/useChat'
import ParticipantList from '../components/meeting/ParticipantList'
import ControlBar from '../components/meeting/ControlBar'
import toast from 'react-hot-toast'
import { useAuth, useUser } from '@clerk/react'
import api from '../config/api'
import Loader from '../components/Loader'
import { UsersIcon } from 'lucide-react'

const MeetingRoom = () => {
  const {meetingId} = useParams()
  const navigate = useNavigate()
  const {user} = useUser()
  const { getToken } = useAuth()

  

  const userdata = useMemo(()=>{
    if(!user) return null;
    return {
      id: user.id,
      name: user.fullName || user.firstName || user.primaryEmailAddress?.emailAddress?.split("@")[0] || "User",
      email: user.primaryEmailAddress?.emailAddress || "",
      image: user.imageUrl || "",
    }
  },[user?.id, user?.fullName, user?.firstName, user?.primaryEmailAddress?.emailAddress, user?.imageUrl])

   const [meeting, setMeeting] = useState(null)
   const [loadingMeeting, setLoadingMeeting] = useState(true);
  const [isParticipantsOpen, setIsParticipantsOpen] = useState(false)

  // Fetch meeting details to verify validity BEFORE enabling WebRTC camera access
  useEffect(()=>{
    const fetchMeeting = async ()=>{
      try {
        const token = await getToken();
        const res = await api.get(`/api/meetings/${meetingId}`, {
          headers: { Authorization: `Bearer ${token}`, },
        })
        if (res.data.meeting.status === "ended"){
          toast.error("This meeting has ended");
           navigate("/dashboard");
           return;
        }
        setMeeting(res.data.meeting)
      } catch (error) {
        const errorMsg = error.response?.data?.error || "Meeting not found or has ended";
        toast.error(errorMsg);
        navigate("/dashboard");
      }finally{
        setLoadingMeeting(false);
      }
    }

    fetchMeeting();

  },[meetingId, navigate])

  const handleMeetingEnded = useCallback(()=>{
    navigate('/dashboard')
  },[navigate])

  // Initialize WebRTC
  const {localStream, remoteUsers, audioEnabled, videoEnabled, toggleAudio, toggleVideo, endMeeting} = useWebRTC(meetingId, userdata, handleMeetingEnded, Boolean(meeting))

   // Initialize Chat
   const {messages, sendMessage, unreadCount, isChatOpen, toggleChat} = useChat(meetingId, userdata)

  const hostId = meeting?.host?.id || meeting?.host;
  const isHost = Boolean(userdata?.id && hostId && hostId.toString() === userdata.id.toString())

  const handleLeave = () =>{
    toast("You left the meeting");
    navigate("/dashboard")
  }

  const handleEndMeeting = () => {
    endMeeting();
  };

  if(loadingMeeting){
    return <Loader text="Joining meeting room..."/>
  }

  return (
    <div className='h-screen w-screen bg-slate-100 text-slate-900 flex flex-col overflow-hidden relative font-sans'>
       {/* Top Bar */}
       <header className="w-full bg-white/90 backdrop-blur-md px-6 py-3 border-b border-slate-200 flex items-center justify-between z-30 shadow-xs">
          <div className="flex items-center gap-3">
              <h2 className="text-base font-semibold text-slate-900 tracking-tight">
                {meeting?.title || "Instant Meeting"} ({meetingId})
              </h2>
              <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse"/>
          </div>

          <button 
             onClick={() => setIsParticipantsOpen((prev) => !prev)}
             className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-100 hover:bg-slate-200 border border-slate-200/80 text-xs font-semibold text-slate-700 transition-colors cursor-pointer shadow-2xs"
             title="Click to toggle participants list">
             <UsersIcon className="w-3.5 h-3.5 text-primary" />
             <span>{1 + remoteUsers.length} {1 + remoteUsers.length === 1 ? "Participant" : "Participants"}</span>
          </button>
       </header>

       {/* Main Content Area (Video Grid + Side Panels) */}
       <div className="flex-1 flex overflow-hidden relative">
          {/* Video Grid Center */}
          <VideoGrid
          localStream={localStream}
          localUser={userdata}
          remoteUsers={remoteUsers}
          audioEnabled={audioEnabled}
          videoEnabled={videoEnabled} />

          {/* In-Meeting Chat Drawer */}
          <ChatPanel 
          isOpen={isChatOpen}
          onClose={toggleChat}
          messages={messages}
          onSendMessage={sendMessage}
          currentUser={userdata}
          />

          {/* Participants Drawer */}
          <ParticipantList 
          isOpen={isParticipantsOpen}
          onClose={()=> setIsParticipantsOpen(false)}
          localUser={userdata}
          localAudio={audioEnabled}
          localVideo={videoEnabled}
          remoteUsers={remoteUsers}
          meetingHostId={hostId}
          />

          
       </div>

    {/* Bottom Floating Control Bar */}
          <ControlBar
          roomId={meetingId}
          audioEnabled={audioEnabled}
          videoEnabled={videoEnabled}
          onToggleAudio={toggleAudio}
          onToggleVideo={toggleVideo}
          onToggleChat={toggleChat}
          onToggleParticipants={()=> setIsParticipantsOpen((prev)=> !prev)}
          isChatOpen={isChatOpen}
          isParticipantsOpen={isParticipantsOpen}
          unreadCount={unreadCount}
          participantCount={1 + remoteUsers.length}
          isHost={isHost}
          onLeave={handleLeave}
          onEndMeeting={handleEndMeeting}
          />
    </div>
  )
}

export default MeetingRoom