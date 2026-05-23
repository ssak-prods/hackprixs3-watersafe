import os
import sys
from huggingface_hub import HfApi, create_repo

def upload_to_hface(token, repo_name="watersafe-v2-analyzer"):
    api = HfApi()
    
    try:
        user = api.whoami(token=token)
        repo_id = f"{user['name']}/{repo_name}"
        
        print(f"Target Repository: {repo_id}")
        
        # Create repo if not exists
        create_repo(repo_id, repo_type="space", space_sdk="gradio", token=token, exist_ok=True)
        
        # Upload all files
        api.upload_folder(
            folder_path="hface_space",
            repo_id=repo_id,
            repo_type="space",
            token=token
        )
        print(f"\n🚀 Success! Your interactive research hub is live at: https://huggingface.co/spaces/{repo_id}")
        
    except Exception as e:
        print(f"❌ Error during upload: {e}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python upload_to_hface.py <YOUR_HF_TOKEN> [repo_name]")
        sys.exit(1)
    
    hf_token = sys.argv[1]
    name = sys.argv[2] if len(sys.argv) > 2 else "watersafe-v2-analyzer"
    upload_to_hface(hf_token, name)
