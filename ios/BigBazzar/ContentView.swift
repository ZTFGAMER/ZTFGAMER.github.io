import SwiftUI

struct ContentView: View {
    var body: some View {
        ZStack {
            Color.black
                .edgesIgnoringSafeArea(.all)

            WebView()
                .edgesIgnoringSafeArea(.all)
        }
        .statusBar(hidden: true)
    }
}

#Preview {
    ContentView()
}
